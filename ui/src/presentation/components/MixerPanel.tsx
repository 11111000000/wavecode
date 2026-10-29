import { For, Show, createMemo, createSignal } from 'solid-js';
import { appStore, dispatch } from '../state/appStore';
import { parseStackTopLayers, type LayerDescriptor } from '~/domain/layers/parseStack';
import { scheduleMixLive } from '../state/audioActions';

/**
 * MixerPanel — collapsible `<details>` со списком слоёв текущей партитуры.
 *
 * Row layout: `[M] [S] [name] ──○── [gain-value]`
 *   M = mute toggle
 *   S = solo toggle
 *   name = auto-detected (Bass / Arp / Samples / Layer N)
 *   slider = 0..1.5 amplitude scalar
 *
 * Multi-section scores (`cat(stack(…), stack(…), …)`) produce one
 * row per layer of EVERY stack — see `validateForMixer`. Grouping is
 * by the `section` ordinal the walker assigns, so a 44-layer preset
 * (`edm-house`) stays readable instead of collapsing into an
 * undifferentiated wall of sliders. Sections are collapsed by default;
 * the header shows "N / M слоёв" so the user can see the row count
 * without expanding.
 *
 * Side-state: `appStore.layerMix` — отдельный от `score` срез, поэтому
 * ИИ-edit не задевает mixer. Reconciled при `setLayerCount`.
 *
 * Live push: каждый onInput / onClick дёргает `dispatch(...)` (single
 * source of truth) И `scheduleMixLive(layerMix)` (debounced 50 ms
 * AudioEngine.setLayerMix — hot-swap через `repl.evaluate(newSnippet)`
 * без stop()). Listen-back в DAW-стиле без ручного ▶ Play.
 * Пакет: decisions/wavecode-mixer-live-update.yaml.
 */
export function MixerPanel() {
  const layers = createMemo(() => parseStackTopLayers(appStore.score));
  const sectionCount = createMemo(() => {
    const l = layers();
    return l.length === 0 ? 0 : l[l.length - 1]!.section + 1;
  });
  // Sections start collapsed; a single-section score (the common case)
  // has nothing to expand, so its header is inert.
  const [openSections, setOpenSections] = createSignal<ReadonlySet<number>>(new Set());

  const isOpen = (section: number): boolean =>
    sectionCount() <= 1 || openSections().has(section);

  const toggleSection = (section: number): void => {
    if (sectionCount() <= 1) return;
    setOpenSections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const bySection = createMemo(() => {
    const groups = new Map<number, LayerDescriptor[]>();
    for (const layer of layers()) {
      const list = groups.get(layer.section);
      if (list === undefined) groups.set(layer.section, [layer]);
      else list.push(layer);
    }
    return [...groups.entries()].sort((a, b) => a[0] - b[0]);
  });

  // Reconcile mixer rows when the parsed stack size changes.
  // Use a reactive that fires on either signal but does NOT mutate score.
  const reconcile = createMemo(() => {
    const count = layers().length;
    const current = appStore.layerMix.length;
    if (count !== current) {
      // Schedule dispatch outside the effect's synchronous track.
      queueMicrotask(() => dispatch({ type: 'setLayerCount', count }));
    }
    return count;
  });

  return (
    <div class="mixer-panel" role="group" aria-label="Mixer">
      <div class="mixer-summary">
        Mixer · {layers().length} слоёв
        <Show when={sectionCount() > 1}>
          <span class="mixer-sections-hint"> · {sectionCount()} секции</span>
        </Show>
      </div>
      <Show when={layers().length > 0} fallback={<div class="mixer-empty">нет слоёв</div>}>
        <div class="mixer-list" data-count={reconcile()} data-sections={sectionCount()}>
          <For each={bySection()}>
            {([section, rows]) => (
              <Show
                when={sectionCount() > 1}
                fallback={
                  <LayerRows rows={rows} />
                }
              >
                <div class="mixer-section" data-section={section}>
                  <button
                    type="button"
                    class="mixer-section-toggle"
                    aria-expanded={isOpen(section)}
                    onClick={() => toggleSection(section)}
                  >
                    <span class="mixer-section-caret">{isOpen(section) ? '▾' : '▸'}</span>
                    <span>секция {section + 1}</span>
                    <span class="mixer-section-count">{rows.length} сл.</span>
                  </button>
                  <Show when={isOpen(section)}>
                    <LayerRows rows={rows} />
                  </Show>
                </div>
              </Show>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function LayerRows(props: { rows: ReadonlyArray<LayerDescriptor> }) {
  return (
    <div class="mixer-rows">
      <For each={props.rows}>
        {(layer) => {
          const mix = () => appStore.layerMix[layer.index];
          const gain = () => mix()?.gain ?? 1;
          const muted = () => mix()?.muted ?? false;
          const soloed = () => mix()?.soloed ?? false;
          return (
            <div class="mixer-row" data-index={layer.index}>
              <button
                type="button"
                class="mixer-btn mixer-mute"
                classList={{ 'is-active': muted() }}
                aria-pressed={muted()}
                title={`Mute layer ${layer.index}`}
                onClick={() => {
                  dispatch({ type: 'toggleLayerMute', index: layer.index });
                  scheduleMixLive(appStore.layerMix);
                }}
              >
                M
              </button>
              <button
                type="button"
                class="mixer-btn mixer-solo"
                classList={{ 'is-active': soloed() }}
                aria-pressed={soloed()}
                title={`Solo layer ${layer.index}`}
                onClick={() => {
                  dispatch({ type: 'toggleLayerSolo', index: layer.index });
                  scheduleMixLive(appStore.layerMix);
                }}
              >
                S
              </button>
              <span class="mixer-name" title={layer.source}>
                {layer.index}: {layer.name}
              </span>
              <input
                type="range"
                class="mixer-gain"
                min="0"
                max="1.5"
                step="0.01"
                value={gain()}
                aria-label={`Gain for layer ${layer.index}`}
                onInput={(e) => {
                  dispatch({
                    type: 'setLayerGain',
                    index: layer.index,
                    gain: Number(e.currentTarget.value),
                  });
                  scheduleMixLive(appStore.layerMix);
                }}
              />
              <span class="mixer-gain-val">{gain().toFixed(2)}</span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
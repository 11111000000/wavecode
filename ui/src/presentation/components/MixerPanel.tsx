import { For, Show, createMemo } from 'solid-js';
import { appStore, dispatch } from '../state/appStore';
import { parseStackTopLayers } from '~/domain/layers/parseStack';
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
      <div class="mixer-summary">Mixer · {layers().length} слоёв</div>
      <Show when={layers().length > 0} fallback={<div class="mixer-empty">нет слоёв</div>}>
        <div class="mixer-list" data-count={reconcile()}>
          <For each={layers()}>
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
      </Show>
    </div>
  );
}

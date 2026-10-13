import { Show, For, type JSX } from 'solid-js';
import { allPresets } from '~/presentation/state/presetsStore';
import { StepIcon, PianoIcon } from '~/presentation/icons';
import { beep } from '~/presentation/state/audioActions';

export type PresetRowProps = {
  presetId: string;
  showStepGrid: boolean;
  showPiano: boolean;
  showSavePreset: boolean;
  newPresetName: string;
  onLoadPreset: (id: string) => void;
  onToggleStepGrid: () => void;
  onTogglePiano: () => void;
  onShowSavePreset: (v: boolean) => void;
  onNewPresetName: (v: string) => void;
  onSavePreset: () => void;
};

export function PresetRow(props: PresetRowProps): JSX.Element {
  return (
    <>
      <div class="app-preset-row">
        <select
          class="preset-select"
          value={props.presetId}
          onChange={(e) => props.onLoadPreset(e.currentTarget.value)}
          title="Готовые пресеты"
        >
          <optgroup label="Встроенные">
            <For each={allPresets().filter((p) => !p.custom)}>
              {(p) => <option value={p.id}>{p.name}{p.artist ? ` · ${p.artist}` : ''}</option>}
            </For>
          </optgroup>
          <Show when={allPresets().some((p) => p.custom)}>
            <optgroup label="Мои">
              <For each={allPresets().filter((p) => p.custom)}>
                {(p) => <option value={p.id}>⭐ {p.name}</option>}
              </For>
            </optgroup>
          </Show>
        </select>
        <div class="app-preset-row__spacer" />
        <button
          type="button"
          class="wc-chip"
          data-active={props.showStepGrid ? 'true' : 'false'}
          onClick={props.onToggleStepGrid}
        >
          <StepIcon size={14} />
          <span>Step</span>
        </button>
        <button
          type="button"
          class="wc-chip"
          data-active={props.showPiano ? 'true' : 'false'}
          onClick={props.onTogglePiano}
        >
          <PianoIcon size={14} />
          <span>Piano</span>
        </button>
        <button type="button" class="wc-chip" onClick={() => beep(440)}>440</button>
        <button type="button" class="wc-chip" onClick={() => beep(220)}>220</button>
      </div>

      <Show when={props.showSavePreset}>
        <div class="save-preset-bar">
          <input
            type="text"
            placeholder="Имя пресета"
            value={props.newPresetName}
            onInput={(e) => props.onNewPresetName(e.currentTarget.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') props.onSavePreset(); }}
          />
          <button
            type="button"
            class="ctrl-btn ctrl-btn-primary"
            onClick={props.onSavePreset}
            disabled={!props.newPresetName.trim()}
          >
            OK
          </button>
          <button
            type="button"
            class="ctrl-btn"
            onClick={() => {
              props.onShowSavePreset(false);
              props.onNewPresetName('');
            }}
          >
            Отмена
          </button>
        </div>
      </Show>
    </>
  );
}

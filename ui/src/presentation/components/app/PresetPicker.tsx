import { For, Show, type JSX } from 'solid-js';
import { allPresets } from '~/presentation/state/presetsStore';
import {
  currentPresetId,
  loadPresetById,
  presetDraft,
  savePresetDraft,
} from '~/presentation/state/presetActions';
import { SaveIcon, CloseIcon } from '~/presentation/icons';

/**
 * PresetPicker — выбор композиции.
 *
 * wavecode-zen-ui-phases-6-7 (фаза 6): раньше `<select>` с
 * композициями стоял в транспортной строке и занимал второе место по
 * ширине. По плану «пресеты — в лист», поэтому теперь он живёт в
 * листе «Инструменты», а транспортная строка — это ровно
 * «play · темп · позиция».
 *
 * Здесь же — черновик «сохранить как свою»: раньше поле для имени
 * появлялось полосой под транспортом, то есть в другом месте, чем
 * сам список композиций. Теперь обе операции рядом.
 */
export function PresetPicker(): JSX.Element {
  return (
    <section class="wc-preset-picker" aria-label="Композиции">
      <label class="wc-preset-picker__label" for="wc-preset-select">
        Композиция
      </label>
      <select
        id="wc-preset-select"
        class="preset-select"
        value={currentPresetId()}
        onChange={(e) => loadPresetById(e.currentTarget.value)}
        title="Готовые композиции"
        aria-label="Выбор композиции"
        data-testid="preset-select"
      >
        <optgroup label="Встроенные">
          <For each={allPresets().filter((p) => !p.custom)}>
            {(p) => (
              <option value={p.id}>
                {p.name}{p.artist ? ` · ${p.artist}` : ''}
              </option>
            )}
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

      <Show
        when={presetDraft.open()}
        fallback={
          <button
            type="button"
            class="wc-preset-picker__btn"
            data-testid="preset-save-open"
            onClick={() => presetDraft.setOpen(true)}
          >
            <SaveIcon size={14} />
            <span>Сохранить как…</span>
          </button>
        }
      >
        <div class="wc-preset-picker__draft">
          <input
            type="text"
            class="wc-preset-picker__input"
            placeholder="Имя композиции"
            aria-label="Имя новой композиции"
            data-testid="preset-name-input"
            value={presetDraft.name()}
            onInput={(e) => presetDraft.setName(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') savePresetDraft();
            }}
          />
          <button
            type="button"
            class="wc-preset-picker__btn wc-preset-picker__btn--primary"
            data-testid="preset-save-confirm"
            disabled={!presetDraft.name().trim()}
            onClick={() => savePresetDraft()}
          >
            Сохранить
          </button>
          <button
            type="button"
            class="wc-preset-picker__btn"
            data-testid="preset-save-cancel"
            onClick={() => {
              presetDraft.setOpen(false);
              presetDraft.setName('');
            }}
          >
            <CloseIcon size={12} />
            <span>Отмена</span>
          </button>
        </div>
      </Show>
    </section>
  );
}

import { For, type JSX } from 'solid-js';
import { MELODIC_INSTRUMENTS, soundGlyph, soundLabel } from '~/domain/sounds';

/**
 * SoundSelect — выбор инструмента (звука слоя).
 *
 * Зачем он отдельный компонент, а не «ещё один `<select>`» в трёх
 * местах: список инструментов, подписи и правило «имя в `.s("…")` —
 * это имя из каталога `sounds.ts`». Если каждый экран собирал свой
 * список, они разъехались бы — и человек выбрал бы в пиано-ролле
 * «Синт-бас», а получил бы в партитуре `s("synth_lead")`.
 *
 * Нативный `<select>` — единственный вариант, который работает на
 * телефоне: 12 кнопок не влезают в 360 px, а системная шторка
 * выбора влезает всегда.
 */
export type SoundSelectProps = {
  /** Текущий инструмент (имя звука из каталога). */
  readonly value: string;
  /** Выбран новый инструмент. */
  readonly onChange: (id: string) => void;
  /** Подпись для скринридера — что именно выбирается. */
  readonly label: string;
  /** Дополнительный CSS-класс на корневой `<label>`. */
  readonly class?: string | undefined;
  /** Показывать глиф инструмента слева. */
  readonly glyph?: boolean;
};

export function SoundSelect(props: SoundSelectProps): JSX.Element {
  const known = (id: string): boolean =>
    MELODIC_INSTRUMENTS.some((s) => s.id === id);
  return (
    <label class={`instrument-selector${props.class ? ` ${props.class}` : ''}`} aria-label={props.label}>
      {props.glyph === false ? null : (
        <span class="inst-glyph" aria-hidden="true">
          {soundGlyph(props.value)}
        </span>
      )}
      <select
        class="inst-select"
        value={props.value}
        onChange={(e) => { props.onChange(e.currentTarget.value); }}
      >
        {/* Звук, которого нет в каталоге (например, чужой пресет),
            всё равно должен быть виден — иначе интерфейс молча
            подменил бы чужой инструмент своим. */}
        {known(props.value) ? null : (
          <option value={props.value}>{`${soundLabel(props.value)} (нет в каталоге)`}</option>
        )}
        <For each={MELODIC_INSTRUMENTS}>
          {(sound) => (
            <option value={sound.id} title={`${sound.label} — s("${sound.id}")`}>
              {sound.label}
            </option>
          )}
        </For>
      </select>
    </label>
  );
}

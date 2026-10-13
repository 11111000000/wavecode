import type { JSX } from 'solid-js';

/**
 * Architecture — диаграмма pipeline из README.md как визуальный flow.
 * Циан = источник данных, амбер = выход, dashed — внешний сервис.
 *
 * Слой DI, эффекты и Web Audio API проиллюстрированы как
 * отдельные «узлы» pipeline. Это именно тот flow, который
 * запускается при клике на play в редакторе.
 */
export function Architecture(): JSX.Element {
  return (
    <section id="architecture" class="l-section" aria-labelledby="arch-title">
      <header class="l-section__head">
        <span class="l-section__kicker">05 · architecture</span>
        <h2 class="l-section__title" id="arch-title">
          Один браузерный процесс. Открытый flow.
        </h2>
        <p class="l-section__sub">
          Solid UI сверху, Effect-TS как рантайм оркестровки, LLM и
          Web Audio как эффекты на границе. Никакого бэкенда, никакой
          координации процессов — поток данных идёт прямо в браузере.
        </p>
      </header>

      <div class="l-arch" role="figure" aria-label="Поток данных wavecode">

        {/* LLM row */}
        <div class="l-arch__row">
          <div class="l-arch__node l-arch__node--src">user message</div>
          <span class="l-arch__arrow">dispatch</span>
          <div class="l-arch__node">agentLoop</div>
          <span class="l-arch__arrow">stream</span>
          <div class="l-arch__node l-arch__node--ext">llm.kosov.online</div>
        </div>

        {/* Editor row */}
        <div class="l-arch__row">
          <div class="l-arch__node l-arch__node--src">solid-js UI</div>
          <span class="l-arch__arrow">edit</span>
          <div class="l-arch__node">CodeMirror 6</div>
          <span class="l-arch__arrow">eval</span>
          <div class="l-arch__node">@strudel/webaudio</div>
        </div>

        {/* Audio row */}
        <div class="l-arch__row">
          <div class="l-arch__node l-arch__node--sink">Web Audio API</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node">oscillators</div>
          <span class="l-arch__arrow">+</span>
          <div class="l-arch__node l-arch__node--sink">▷ speakers</div>
        </div>

        {/* Persistence row */}
        <div class="l-arch__row">
          <div class="l-arch__node l-arch__node--ext">autosave · 500 ms</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node">idb-keyval</div>
          <span class="l-arch__arrow">→</span>
          <div class="l-arch__node l-arch__node--src">IndexedDB</div>
        </div>

        <div class="l-arch__legend" aria-hidden="true">
          <span class="l-arch__legend-item">
            <span class="l-arch__legend-swatch" style={{ background: 'var(--cyan-soft)', border: '1px solid var(--cyan)' }} />
            <span>источник (UI / signal)</span>
          </span>
          <span class="l-arch__legend-item">
            <span class="l-arch__legend-swatch" style={{ background: 'var(--amber-soft)', border: '1px solid var(--amber)' }} />
            <span>приёмник (audio)</span>
          </span>
          <span class="l-arch__legend-item">
            <span class="l-arch__legend-swatch" style={{ background: 'transparent', border: '1px dashed var(--border-strong)' }} />
            <span>внешний сервис (нет своего бэка)</span>
          </span>
        </div>
      </div>
    </section>
  );
}

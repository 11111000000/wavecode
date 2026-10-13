---
proposition: |
  Второй пакет legacy.css eating — **AI chat panel + collapsible
  panels** (lines 195-322, 324-496). Это ~300 строк legacy.css.

  Секции:
    - COLLAPSIBLE PANELS (lines 195-322):
        .app-body, .collapsible, .score-panel, .score-panel-inner,
        .ai-panel, .status-panel, .panel-header, .collapse-toggle,
        .caret, .panel-hint
    - CHAT (lines 324-496):
        .ai-edit-panel-inner, .ai-messages, .ai-messages-empty,
        .ai-message[-user|-assistant|-system], .ai-message-meta,
        .ai-message-body, .ai-footer, .ai-textarea, .ai-controls-row1,
        .ai-apply-btn, .ai-status, .ai-status-row, .ai-retry-btn,
        .ai-status-ok, .ai-status-err

  ~30 классов. Все живые (PanelsLayout.tsx, AIEditPanel.tsx,
  ScorePanel.tsx). Причина отдельного пакета от
  `wavecode-legacy-eat-transport` — chat panel доминирует на
  экране при открытии AI-вкладки; визуальная регрессия тут
  наиболее заметна юзеру.
antithesis: |
  (1) «ScorePanel / .app-body не AI-specific, не должны быть
  в этом пакете». Возражение: они делят общий COLLAPSIBLE PANELS
  section с .ai-panel в legacy.css. Распилить на 3 пакета =
  3 коммита с одинаковой cascade-логикой и 3 review. Один
  пакет — один ритуал, single source of truth для панельной
  геометрии.
  (2) «Migrate ScorePanel отдельно потом, чтобы не смешивать
  AI-стили с score». Возражение: visual independence не страдает
  — пакет — mechanical move без рефакторинга. Cascade layers
  по-прежнему разделяют. Review-чисто.
  (3) «Что если .app-body в components.css уже определён?».
  Возражение: проверено `grep -nE "^\.app-body" components.css`
  — нет, определение только в legacy. Без конфликта.
synthesis: |
  Один коммит (`refactor(ui): migrate AI + panels to components.css`):

  1. **components.css** (append ~300 строк):
     добавить секции:
       COLLAPSIBLE PANELS — migrated from legacy.css v2
       CHAT (AI panel messenger) — migrated from legacy.css v2
     В конец файла (после TRANSPORT PANEL).

  2. **legacy.css** (delete ~300 строк):
     удалить секции lines 195-322 и 324-496.

  Cascade не меняется (source-order внутри components.css).
  Шапка секции-комментария помечена "migrated from legacy.css v2"
  для grep-навигации.

  Verification:
    - typecheck: clean
    - vitest: ≥632/632 (existing AI/chat tests не покрывают CSS
      layout, но и не должны падать)
    - smoke test (playwright): открыть AI tab через BottomToolstrip
      или setTab('chat'), проверить computed style .ai-message
      (background: surface-2, border, border-radius)
    - build: bundle size delta < 1KB

  After this: legacy.css 1071 → ~770 lines (-300). Remaining
  sections: APP SHELL, BUTTON, SAVE PRESET BAR, MIDI I/O BAR,
  MIXER PANEL, RECORD, SHARE MODAL, CODEMIRROR, MINI-NOTATION
  TOOLBAR, PIANO & STEP GRID.
status: draft
---
---
proposition: |
  Иконка сайта в трёх местах показывала «wc» вместо нового
  spectrum-логотипа:

  1. **Tab favicon** (`ui/public/favicon.svg`) — старый
     waveform-SVG с буквальным `<text>wc</text>` в правом нижнем
     углу, viewBox 48×16 (горизонтальная полоска). Юзер видел
     «wc» в табе браузера и в закладках.
  2. **HTML boot loader** (`ui/index.html`, строки 277-309) —
     inline-копия того же самого SVG, 240×80 в центре pre-Solid
     экрана загрузки.
  3. **TopBar редактора** (`ui/src/presentation/components/app/
     TopBar.tsx:45`) — компонент `<BrandLogo size={22} />`,
     который в `presentation/icons/index.tsx:325` рендерил тот же
     старый waveform-SVG с `<text>wc</text>` (только шириной
     `size * 3`).

  Всё это были следы от старого брендинга — до того, как
  дизайн перешёл на spectrum-gradient (amber #ffaa3b → cyan
  #5eead4 → magenta #f472b6) с фирменной 48×48 square-tile
  waveform (используется в LED-chip, hex-grid, preset-row
  amber dot).

  Решение — заменить BrandLogo на новый 48×48 WavecodeLogo
  (gradient waveform на slate rounded-square + pulsing amber
  dot + magenta cursor-block), и распространить его в
  favicon, boot loader и TopBar.
antithesis: |
  (1) «Оставь BrandLogo как алиас, не делай новый компонент —
  просто замени BrandLogo inline». Возражение: BrandLogo
  использовался в 1 месте (TopBar) согласно поиску; нет смысла
  держать два имени. Делаю один WavecodeLogo + BrandLogo
  = WavecodeLogo для back-compat (на случай если что-то ещё
  импортирует, увидит новый логотип без сюрпризов).
  (2) «Не трогай boot loader — он в index.html, не в bundle».
  Возражение: index.html — это Vite template, копируется в
  dist/index.html на каждый build. Заменить 1 раз, актуально
  для всех будущих deploy'ов.
  (3) «PNG-иконки (icon-192/512, apple-touch-icon-180) тоже
  старые». Возражение: согласовано, но перегенерация PNG
  требует rsvg-convert/inkscape (нет в PATH). В этом коммите
  обновляю только SVG (favicon.svg, который современные
  браузеры предпочитают), а PNG — отдельным коммитом когда
  появится конвертер. PWA manifest пока ссылается на старые
  PNG, но это не блокирует UX.
  (4) «В TopBar иконка не нужна — там только текст 'wavecode'».
  Возражение: BrandLogo был в TopBar с самого начала (commit
  `325: <BrandLogo size={22} />`). Удаление — отдельная
  задача дизайна; минимальное изменение — заменить BrandLogo
  на WavecodeLogo, сохранив позицию и размер.
synthesis: |
  Четыре правки:

  1. **`ui/src/presentation/icons/index.tsx`** (modify, ~80 lines
     rewritten): удалён старый BrandLogo, добавлен новый
     `WavecodeLogo` (48×48 spectrum-tile, gradient waveform,
     pulsing amber dot, magenta cursor-block с animate).
     `BrandLogo = WavecodeLogo` как back-compat alias.

  2. **`ui/src/presentation/components/app/TopBar.tsx`** (modify,
     2 lines): import `WavecodeLogo` вместо `BrandLogo`,
     `<WavecodeLogo size={22} />` вместо `<BrandLogo size={22} />`.

  3. **`ui/index.html`** (modify, ~30 lines): boot loader SVG
     заменён на ту же 48×48 spectrum-tile (width/height=80,
     viewBox=0 0 48 48) — без `<text>wc</text>`. Добавлен
     `feGaussianBlur` glow под основным path (мягкое свечение
     в духе accent-glow эффектов дизайн-системы).

  4. **`ui/public/favicon.svg`** (rewrite, 22 lines → 26 lines):
     полностью переписан с 48×16 waveform+`<text>wc</text>` на
     48×48 spectrum-tile. Совпадает с inline boot loader (для
     consistency).

  Verification (post-deploy):
  - `curl -I https://wavecode.kosov.online/favicon.svg` → 200,
    `Content-Type: image/svg+xml`, `Content-Length: 1248`.
  - `grep -c "wc-text\|>wc<" dist/favicon.svg dist/index.html` → 0.
  - Playwright DOM probe в TopBar: `wc-wavecode-logo` SVG,
    22×22, viewBox=`0 0 48 48`, без `wc`-текста.
  - Manual: tab favicon обновляется при следующем reload.
status: applied
witness:
  applied_at: 2026-10-13
  commit: 047b290
  supersedes: null
  notes: |
    Implementation in one commit (047b290).
    Verification: typecheck clean, deploy successful,
    Playwright DOM probe confirmed `wc-wavecode-logo` 22×22
    in TopBar, no `>wc<` text in dist/favicon.svg or
    dist/index.html. Curl on /favicon.svg returns the new
    1248-byte SVG.

    Not regenerated in this commit (deferred to follow-up):
      - ui/public/icon-192.png
      - ui/public/icon-512.png
      - ui/public/apple-touch-icon-180.png
    Reason: no SVG→PNG converter (rsvg-convert/inkscape)
    in PATH on this host. They keep the old `wc` waveform
    for now. iOS/Android PWA install will use the old icon
    until a converter is added.
---
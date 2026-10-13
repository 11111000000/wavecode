import { test, expect, type Page } from '@playwright/test';

/**
 * Piano e2e — verifies the polyphonic + Web Audio PianoKeyboard
 * from `math/wavecode-piano-polyphony` and the
 * wavecode-piano-parallel-rec-instrument toolbar.
 *
 * Actual selectors (verified against current source — Phase 3 / 4):
 *   - .piano-wrap                                 outer wrapper
 *   - .piano-toolbar                              toolbar div
 *   - .piano-toolbar-row                           inner row (RecBtn + Instr + MIDI pill)
 *   - .piano-hint                                 "2 octaves (C3–B4) …" hint
 *   - .piano-rec-btn                              REC toggle (data-active + aria-pressed)
 *   - .piano-inst-btn                             4 instrument buttons (triangle/sine/sawtooth/square)
 *   - .piano-instrument-selector                  group wrapper around the 4 buttons
 *   - .piano-midi-status                          MIDI status pill (hidden when MIDI unavailable)
 *   - .piano-midi-source                          source-attribution chip (child of pill, only when set)
 *   - .piano-keys > .piano-keys-inner             key row
 *   - button.piano-key.white[aria-label="C4"]     one specific white key
 *   - button.piano-key.black[aria-label="C#4"]    one specific black key
 *   - button.piano-key.white.active               key held down (optimistic — set on pointerdown,
 *                                                   cleared on pointerup/leave)
 *
 * Why the original stub is wrong:
 *   The original spec relied on `window.__wavecodeActiveOsc()` to
 *   count active oscillators. That global was NEVER implemented —
 *   `PianoSynth.activeCount()` exists as a closure-scope method but
 *   is not exposed to window. The visual feedback (.piano-key.active)
 *   is the only portable observable.
 *
 *   Also: `__wavecodeAudioCtx` is still real (LiveAudioEngine.ts sets
 *   it on `unlockAudioContext()`). We can check `state === 'running'`
 *   to confirm audio was unlocked by a user gesture, but NOT a
 *   per-key oscillator count.
 *
 * MIDI note:
 *   Headless Chromium does NOT implement navigator.requestMIDIAccess,
 *   so `isMidiAvailable()` returns false and the .piano-midi-status
 *   pill is hidden via `<Show when={props.midiStatus}>`. To make the
 *   "no source attribution before any MIDI activity" assertion
 *   deterministic in either env, the test mocks requestMIDIAccess
 *   via addInitScript to expose a single fake input named "FakeMIDI".
 *   Then the pill renders as `MIDI: 1 device` with no source chip
 *   (because no notes have been pressed yet — activeMidiSource is
 *   still null).
 */

const BASE_URL = 'http://127.0.0.1:4173';

/** Mock navigator.requestMIDIAccess with a single fake input. */
const FAKE_MIDI_INIT = `
  (() => {
    const fakeInput = {
      id: 'fake-midi-input-1',
      name: 'FakeMIDI Keyboard',
      onmidimessage: null,
      state: 'connected',
      type: 'input',
      manufacturer: 'e2e-mock',
    };
    const inputs = new Map([['fake-midi-input-1', fakeInput]]);
    const fakeAccess = {
      inputs,
      state: 'connected',
      onstatechange: null,
    };
    try {
      Object.defineProperty(navigator, 'requestMIDIAccess', {
        configurable: true,
        value: () => Promise.resolve(fakeAccess),
      });
    } catch (_) {
      /* already defined — overwrite */
      (navigator).requestMIDIAccess = () => Promise.resolve(fakeAccess);
    }
  })();
`;

async function bootApp(page: Page, opts: { mockMidi?: boolean } = {}): Promise<void> {
  if (opts.mockMidi) {
    await page.addInitScript(FAKE_MIDI_INIT);
  }
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main.app', { timeout: 15_000 });
  // Give onMount a beat to call installConsoleGlobals + load persisted errors
  // + (if mocked) bind the fake MIDI input.
  await page.waitForTimeout(1500);
}

async function openPiano(page: Page): Promise<void> {
  // Piano toggle chip — same selector as piano-parallel.spec.ts.
  // Opens the "piano" bottom sheet and renders <PianoKeyboard/>.
  await page.locator('.app-preset-row button.wc-chip:has-text("Piano")').click();
  await page.waitForSelector('.piano-keys', { timeout: 5000 });
  // Wait for the toolbar (and any MIDI status pill) to render.
  await page.waitForSelector('.piano-toolbar', { timeout: 5000 });
}

test('tapping a single key shows .piano-key.active class and clears it on release', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });

  await bootApp(page);
  await openPiano(page);

  const c4 = page.locator('button.piano-key.white[aria-label="C4"]');
  await expect(c4).toBeVisible();
  await expect(c4).not.toHaveClass(/active/);

  // Synthesize a pointerdown — Solid's onPointerDown handler
  // optimistically marks the key active (before the 30ms debounce
  // resolves), so the class should appear within one animation
  // frame.
  await c4.dispatchEvent('pointerdown', { button: 0 });
  await expect(c4).toHaveClass(/active/, { timeout: 1000 });

  // Release: pointerup + pointerleave stops the note and clears
  // the active set.
  await c4.dispatchEvent('pointerup', { button: 0 });
  await c4.dispatchEvent('pointerleave', { button: 0 });
  await expect(c4).not.toHaveClass(/active/, { timeout: 1000 });

  // No piano-tap errors. Filter out sample-load / MIDI noise that
  // arrives from independent boot phases — Strudel preloads sample
  // banks at app boot and emits `[sampler]` / `[wavecode]` lines that
  // are not caused by the piano tap under test.
  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio|\[sampler\]|\[cyclist\]|\[wavecode\]/i.test(e),
  );
  expect(realErrors, `piano tap emitted errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});

test('polyphony: pressing D4 + E4 simultaneously marks both keys .active', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));

  await bootApp(page);
  await openPiano(page);

  const d4 = page.locator('button.piano-key.white[aria-label="D4"]');
  const e4 = page.locator('button.piano-key.white[aria-label="E4"]');
  await expect(d4).toBeVisible();
  await expect(e4).toBeVisible();

  // Press both nearly-simultaneously — both should show .active.
  await d4.dispatchEvent('pointerdown', { button: 0 });
  await e4.dispatchEvent('pointerdown', { button: 0 });

  await expect(d4).toHaveClass(/active/, { timeout: 1000 });
  await expect(e4).toHaveClass(/active/, { timeout: 1000 });

  // Release one at a time — polyphony means the still-held key
  // stays .active while the other drops out.
  await d4.dispatchEvent('pointerup', { button: 0 });
  await d4.dispatchEvent('pointerleave', { button: 0 });
  await expect(d4).not.toHaveClass(/active/, { timeout: 1000 });
  await expect(e4).toHaveClass(/active/, { timeout: 1000 });

  await e4.dispatchEvent('pointerup', { button: 0 });
  await e4.dispatchEvent('pointerleave', { button: 0 });
  await expect(e4).not.toHaveClass(/active/, { timeout: 1000 });

  const realErrors = errors.filter(
    (e) => !/favicon|DevTools|preload|werkzeug|404|net::ERR_ABORTED|webaudio|\[sampler\]|\[cyclist\]|\[wavecode\]/i.test(e),
  );
  expect(realErrors, `polyphony tap emitted errors: ${JSON.stringify(realErrors)}`).toHaveLength(0);
});

test('piano hint renders "2 octaves (C3–B4)"', async ({ page }) => {
  await bootApp(page);
  await openPiano(page);

  const hint = page.locator('.piano-hint');
  await expect(hint).toBeVisible();
  // The hint string is "2 octaves (C3–B4) — tap or use MIDI keyboard"
  // (en-dash U+2013 between C3 and B4). toContainText is permissive
  // about whitespace.
  await expect(hint).toContainText('2 octaves (C3–B4)');
});

test('rec button is clickable and toggles aria-pressed', async ({ page }) => {
  await bootApp(page);
  await openPiano(page);

  const recBtn = page.locator('.piano-rec-btn');
  await expect(recBtn).toBeVisible();
  // Initial state: aria-pressed="false", data-active="false".
  await expect(recBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(recBtn).toHaveAttribute('data-active', 'false');

  await recBtn.click();
  await expect(recBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(recBtn).toHaveAttribute('data-active', 'true');

  await recBtn.click();
  await expect(recBtn).toHaveAttribute('aria-pressed', 'false');
  await expect(recBtn).toHaveAttribute('data-active', 'false');
});

test('instrument selector has 4 buttons (triangle/sine/sawtooth/square)', async ({ page }) => {
  await bootApp(page);
  await openPiano(page);

  const selector = page.locator('.piano-instrument-selector');
  await expect(selector).toBeVisible();

  const buttons = selector.locator('.piano-inst-btn');
  await expect(buttons).toHaveCount(4);

  // The title attribute holds the lowercase instrument name; verify
  // each of the four is present.
  for (const inst of ['triangle', 'sine', 'sawtooth', 'square']) {
    const btn = selector.locator(`.piano-inst-btn[title="${inst}"]`);
    await expect(btn).toBeVisible();
  }

  // Default is 'triangle' — its data-active is 'true' on first render.
  const triangleBtn = selector.locator('.piano-inst-btn[title="triangle"]');
  await expect(triangleBtn).toHaveAttribute('data-active', 'true');
});

test('piano status pill shows MIDI device count with no source attribution before any MIDI activity', async ({ page }) => {
  // Mock MIDI so the pill is rendered deterministically. Without
  // the mock, headless Chromium hides the pill via <Show> when
  // isMidiAvailable() returns false — and the assertion would
  // be a no-op.
  await bootApp(page, { mockMidi: true });
  await openPiano(page);

  // The pill should now be visible. Wait for the mocked input to
  // be picked up by PianoKeyboard.onMount (microtask after
  // requestMidiAccess resolves).
  const pill = page.locator('.piano-midi-status');
  await expect(pill).toBeVisible({ timeout: 3000 });

  // The mock has 1 input named "FakeMIDI Keyboard". Without any
  // noteOn activity, activeMidiSource() === null, so the pill
  // text is "MIDI: 1 device" and the .piano-midi-source chip is
  // absent.
  await expect(pill).toContainText('MIDI:');
  await expect(pill).toContainText('1 device');
  await expect(pill).not.toContainText(/нот|нота|ноты/);
  await expect(pill.locator('.piano-midi-source')).toHaveCount(0);
  await expect(pill).toHaveAttribute('data-midi-source', '');
  await expect(pill).toHaveAttribute('data-active-count', '0');
});
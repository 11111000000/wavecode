/**
 * WelcomeTour — 5-step onboarding overlay for first-time users.
 *
 * Source of truth: `decisions/wavecode-welcome-tour.yaml`.
 *
 * Mounted at the App level (one line in App.tsx). Self-gates: if
 * the user has already completed the tour (flag set in
 * localStorage) OR they are not on `/#/app`, returns `null`.
 *
 * The overlay highlights ONE element at a time via a
 * `.tour-spotlight` ring sized to the target's bounding rect
 * (recomputed on resize / scroll). A `.tour-tooltip` card with
 * `top` / `bottom` / `left` / `right` positioning anchors to the
 * same rect.
 *
 * Buttons:
 *   - «Пропустить» on every step → markTourComplete() → unmount
 *   - «Дальше →» advances one step (last step's label is
 *     «Готово ✓» and calls markTourComplete instead)
 *   - Escape key → same as «Пропустить»
 *
 * Step 1 (PLAY) auto-advances when the play button is clicked,
 * so the user doesn't have to dismiss a tooltip that just got
 * covered by the audio start indicator. Step 2 (EDIT) auto-
 * advances on the first CodeMirror `docChanged` event. Steps 3
 * and 4 advance on explicit «Дальше» only.
 */

import {
  createSignal, createEffect, onMount, onCleanup, Show,
  type JSX,
} from 'solid-js';
import { useHashRoute } from '~/presentation/state/useHashRoute';
import {
  shouldShowTour, markTourComplete,
} from './tourState';
import { TOUR_STEPS, type TourStep, type TourPosition } from './tourSteps';

type Rect = {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
};

const PADDING_PX = 8;

const ZERO_RECT: Rect = { top: 0, left: 0, width: 0, height: 0 };

const measureTarget = (selector: string): Rect => {
  if (typeof document === 'undefined') return ZERO_RECT;
  if (selector === 'body') {
    return {
      top: 0,
      left: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    };
  }
  const el = document.querySelector(selector);
  if (!el) return ZERO_RECT;
  const r = el.getBoundingClientRect();
  return {
    top: r.top - PADDING_PX,
    left: r.left - PADDING_PX,
    width: r.width + PADDING_PX * 2,
    height: r.height + PADDING_PX * 2,
  };
};

/**
 * Tooltip anchor placement. Each step declares a preferred side;
 * if the target rect is too close to that edge of the viewport,
 * the tooltip flips to the opposite side.
 */
const computeTooltipStyle = (rect: Rect, pref: TourPosition): JSX.CSSProperties => {
  const margin = 16;
  const cardW = 320;
  const cardH = 140;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768;

  if (pref === 'top' && rect.top >= cardH + margin) {
    return {
      left: `${Math.max(margin, Math.min(vw - cardW - margin, rect.left + rect.width / 2 - cardW / 2))}px`,
      bottom: `${vh - rect.top + margin}px`,
      width: `${cardW}px`,
    };
  }
  if (pref === 'bottom' && vh - (rect.top + rect.height) >= cardH + margin) {
    return {
      left: `${Math.max(margin, Math.min(vw - cardW - margin, rect.left + rect.width / 2 - cardW / 2))}px`,
      top: `${rect.top + rect.height + margin}px`,
      width: `${cardW}px`,
    };
  }
  if (pref === 'left' && rect.left >= cardW + margin) {
    return {
      right: `${vw - rect.left + margin}px`,
      top: `${Math.max(margin, Math.min(vh - cardH - margin, rect.top + rect.height / 2 - cardH / 2))}px`,
      width: `${cardW}px`,
    };
  }
  if (pref === 'right' && vw - (rect.left + rect.width) >= cardW + margin) {
    return {
      left: `${rect.left + rect.width + margin}px`,
      top: `${Math.max(margin, Math.min(vh - cardH - margin, rect.top + rect.height / 2 - cardH / 2))}px`,
      width: `${cardW}px`,
    };
  }
  // Fallback: center on viewport, below the target.
  return {
    left: `${Math.max(margin, Math.min(vw - cardW - margin, rect.left + rect.width / 2 - cardW / 2))}px`,
    top: `${Math.min(vh - cardH - margin, rect.top + rect.height + margin)}px`,
    width: `${cardW}px`,
  };
};

export function WelcomeTour(): JSX.Element {
  const route = useHashRoute();
  const [active, setActive] = createSignal<boolean>(shouldShowTour());
  const [stepIndex, setStepIndex] = createSignal<number>(0);
  const [rect, setRect] = createSignal<Rect>(ZERO_RECT);

  const isLast = (): boolean => stepIndex() >= TOUR_STEPS.length - 1;
  const currentStep = (): TourStep | null => {
    if (!active() || route() !== 'app') return null;
    return TOUR_STEPS[stepIndex()] ?? null;
  };

  const recompute = (): void => {
    const step = currentStep();
    if (!step) return;
    setRect(measureTarget(step.target));
  };

  const advance = (): void => {
    if (isLast()) {
      markTourComplete();
      setActive(false);
      return;
    }
    setStepIndex((n) => n + 1);
  };

  const skip = (): void => {
    markTourComplete();
    setActive(false);
  };

  // Initial mount: hide overlay when not on /#/app or flag is set.
  createEffect(() => {
    const onApp = route() === 'app';
    setActive(shouldShowTour() && onApp);
  });

  // Re-measure on every step change AND on viewport resize / scroll.
  createEffect(() => {
    // Subscribe to stepIndex so this re-runs on advance.
    void stepIndex();
    if (!active()) return;
    recompute();
    if (typeof window === 'undefined') return;
    const onResize = (): void => recompute();
    window.addEventListener('resize', onResize, { passive: true });
    window.addEventListener('scroll', onResize, { passive: true });
    onCleanup(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize);
    });
  });

  onMount(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!active()) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        skip();
      }
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => window.removeEventListener('keydown', onKey));
  });

  // Auto-advance when the user actually performs the suggested
  // action. Steps 3 and 4 stay manual — surprising the user mid-
  // prompt / mid-menu would feel like the overlay got in the way.
  createEffect(() => {
    const step = currentStep();
    if (!step || typeof window === 'undefined') return;

    if (step.id === 'play') {
      const playBtn = document.querySelector<HTMLElement>('[data-tour="play"]');
      if (!playBtn) return;
      const onClick = (): void => {
        // Defer one tick so the audio-start indicator has a chance
        // to mount before we move the spotlight.
        window.setTimeout(advance, 250);
      };
      playBtn.addEventListener('click', onClick);
      onCleanup(() => playBtn.removeEventListener('click', onClick));
      return;
    }

    if (step.id === 'edit') {
      const cm = document.querySelector<HTMLElement>('.cm-content');
      if (!cm) return;
      const onInput = (): void => {
        window.setTimeout(advance, 250);
      };
      cm.addEventListener('input', onInput);
      onCleanup(() => cm.removeEventListener('input', onInput));
      return;
    }
  });

  return (
    <Show when={currentStep()}>
      {(stepAccessor) => {
        const r = rect();
        const visible = (): boolean => r.width > 0 || stepAccessor().target === 'body';
        return (
          <div class="tour-overlay" data-testid="welcome-tour" data-step={stepAccessor().id}>
            <div
              class="tour-spotlight"
              data-testid="welcome-tour-spotlight"
              style={{
                top: `${r.top}px`,
                left: `${r.left}px`,
                width: `${r.width}px`,
                height: `${r.height}px`,
                display: visible() ? 'block' : 'none',
              }}
              aria-hidden="true"
            />
            <div
              class="tour-tooltip"
              data-testid="welcome-tour-tooltip"
              role="dialog"
              aria-labelledby="welcome-tour-title"
              aria-describedby="welcome-tour-body"
              style={computeTooltipStyle(r, stepAccessor().position)}
            >
              <div class="tour-tooltip__step" aria-live="polite">
                Шаг {stepIndex() + 1} из {TOUR_STEPS.length}
              </div>
              <h2 id="welcome-tour-title" class="tour-tooltip__title">{stepAccessor().title}</h2>
              <p id="welcome-tour-body" class="tour-tooltip__body">{stepAccessor().body}</p>
              <div class="tour-tooltip__actions">
                <button
                  type="button"
                  class="tour-tooltip__btn tour-tooltip__btn--ghost"
                  data-testid="welcome-tour-skip"
                  onClick={skip}
                >
                  Пропустить
                </button>
                <button
                  type="button"
                  class="tour-tooltip__btn tour-tooltip__btn--primary"
                  data-testid="welcome-tour-next"
                  onClick={advance}
                >
                  {isLast() ? 'Готово ✓' : 'Дальше →'}
                </button>
              </div>
              <div class="tour-tooltip__hint" aria-hidden="true">Esc — закрыть</div>
            </div>
          </div>
        );
      }}
    </Show>
  );
}
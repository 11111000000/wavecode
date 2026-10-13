import {
  type JSX, type ParentProps, createSignal, onCleanup, onMount, Show,
} from 'solid-js';
import { CloseIcon, ExpandIcon, CollapseIcon } from '../icons';
import {
  closeAllSheets,
  snapTo,
  getKindSnap,
  getSheetHeightPx,
  setSheetHeightPx,
  resetSheetHeightPx,
  getActiveTab,
  SHEET_HEIGHT_MIN_PX,
  SHEET_HEIGHT_MAX_PX,
  type SheetKind,
  type SheetSnap,
} from '../state/uiState';
import { SheetTabs } from './SheetTabs';
import { triggerHaptic, triggerSnapPulse } from '~/infrastructure/haptics';

type Props = ParentProps<{
  kind: NonNullable<SheetKind>;
  title: string;
  subtitle?: string;
  initial?: SheetSnap;
  scrollBody?: boolean;
  onClose?: () => void;
}>;

const TAP_THRESHOLD_PX = 8;
const TAP_MAX_MS = 300;

/**
 * BottomSheet — draggable sheet с 3 snap-точками.
 * Mobile:    bottom sheet (in-flow, push-mode), snap = closed | peek(35vh)
 *            | half(50vh) | full(70vh), drag-handle resizes between
 *            240..560px (persisted).
 * Desktop ≥1024px: right-side drawer, snap = closed | open (width 480/720)
 *
 * Drag реализован на pointer events; snap выбирается по release-velocity
 * + position. Tap на handle-area или header toggle-ит snap (full ↔ half);
 * кнопка expand/collapse в шапке даёт явный affordance.
 *
 * Polish (wavecode-mobile-split-pane polish):
 *   - Snap-points indicator (3 dots) inside top-handle shows the
 *     current target snap. Live-updated during drag.
 *   - Snap-feedback pill (cyan "PEEK"/"HALF"/"FULL") floats below
 *     the handle during drag, names the snap level the pointer
 *     position resolves to.
 *   - Sheet body fade-in keyed on `data-content-key` so internal
 *     tab switching (Mixer → AI) cross-fades smoothly.
 */
export function BottomSheet(props: Props): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const [dragDelta, setDragDelta] = createSignal(0);
  const [isMobileViewport, setIsMobileViewport] = createSignal(false);
  const [snapTarget, setSnapTarget] = createSignal<SheetSnap | null>(null);
  let startY = 0;
  let startTime = 0;
  let startSheetH = 0;
  let contentRef: HTMLDivElement | undefined;
  let didDrag = false;
  /** Last snap target the drag crossed — used to fire haptic only
   *  when the pointer position crosses a snap threshold (not on
   *  every move). */
  let lastHapticSnap: SheetSnap | null = null;

  // Re-evaluate viewport on mount + on resize. Determines which
  // drag-handle behavior is active (mobile vertical-resize vs
  // desktop snap-transitions).
  onMount(() => {
    const mql = window.matchMedia('(max-width: 720px)');
    const apply = (e: MediaQueryList | MediaQueryListEvent): void => {
      setIsMobileViewport(e.matches);
    };
    apply(mql);
    mql.addEventListener('change', apply);
    onCleanup(() => mql.removeEventListener('change', apply));
  });

  const currentSnap = (): SheetSnap => getKindSnap(props.kind);

  /** Default px-height for a given snap mode — used to anchor drag
   *  start when the user has not resized manually. */
  const snapHeightFor = (snap: SheetSnap): number => {
    switch (snap) {
      case 'closed': return 0;
      case 'peek':   return Math.round(window.innerHeight * 0.35);
      case 'half':   return Math.round(window.innerHeight * 0.5);
      case 'full':   return Math.round(window.innerHeight * 0.7);
    }
  };

  /** Map a current sheet height in px to a snap target. Used during
   *  drag to drive the snap-points indicator + feedback pill. */
  const targetSnapForHeight = (h: number): SheetSnap => {
    const vh = window.innerHeight;
    if (h < SHEET_HEIGHT_MIN_PX) return 'closed';
    if (h > 0.6 * vh) return 'full';
    if (h > 0.42 * vh) return 'half';
    return 'peek';
  };

  const onPointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement | null)?.closest('[data-no-drag="true"]')) return;
    setDragging(true);
    didDrag = false;
    startY = e.clientY;
    startTime = Date.now();
    startSheetH = getSheetHeightPx() ?? snapHeightFor(currentSnap());
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging()) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > TAP_THRESHOLD_PX) didDrag = true;
    if (isMobileViewport()) {
      // Mobile: vertical drag resizes sheet height.
      const nextH = startSheetH - dy;
      const clamped = Math.max(
        SHEET_HEIGHT_MIN_PX,
        Math.min(SHEET_HEIGHT_MAX_PX, nextH),
      );
      setSheetHeightPx(clamped);
      // Update snap-target live so the 3-dot indicator + feedback
      // pill reflect the current pointer position.
      const target = targetSnapForHeight(clamped);
      setSnapTarget(target);
      // Haptic on snap-threshold crossings only — not every move.
      // Gives the user a tactile cue when they cross peek/half/full.
      if (target !== lastHapticSnap) {
        lastHapticSnap = target;
        triggerHaptic(5);
      }
      return;
    }
    setDragDelta(Math.max(dy, -50));  // small overshoot up
  };
  const onPointerUp = (e: PointerEvent): void => {
    if (!dragging()) return;
    setDragging(false);
    const dy = e.clientY - startY;
    const dt = Math.max(Date.now() - startTime, 1);
    const v = dy / dt;  // px/ms
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    setDragDelta(0);
    setSnapTarget(null);
    lastHapticSnap = null;

    if (isMobileViewport()) {
      // Mobile: snap decision on release. Also fires a stronger
      // haptic pulse on commit so the user gets a "snap confirmed"
      // tactile signal.
      const finalH = getSheetHeightPx() ?? snapHeightFor(currentSnap());
      const vh = window.innerHeight;
      if (finalH < SHEET_HEIGHT_MIN_PX) {
        resetSheetHeightPx();
        snapTo('closed');
        triggerSnapPulse();
      } else if (finalH > 0.6 * vh) {
        // Snap to 'full' — override user height with snap default.
        resetSheetHeightPx();
        snapTo('full');
        triggerSnapPulse();
      } else if (finalH > 0.42 * vh) {
        resetSheetHeightPx();
        snapTo('half');
        triggerSnapPulse();
      } else {
        resetSheetHeightPx();
        snapTo('peek');
        triggerSnapPulse();
      }
      return;
    }

    // Tap (no drag, fast) → cycle snap full ↔ half
    if (!didDrag && dt < TAP_MAX_MS) {
      const current = currentSnap();
      if (current === 'full') snapTo('half');
      else snapTo('full');
      return;
    }

    const current = currentSnap();
    // Snap decision: down if released below current, up if above
    if (dy > 80 || v > 0.5) {
      // swipe down — go to next-larger snap (peek→closed, half→peek, full→half)
      if (current === 'full') snapTo('half');
      else if (current === 'half') snapTo('peek');
      else if (current === 'peek') closeAllSheets();
    } else if (dy < -80 || v < -0.5) {
      // swipe up — go to next-smaller (closed→peek, peek→half, half→full)
      if (current === 'peek') snapTo('half');
      else if (current === 'half') snapTo('full');
      else if (current === 'closed') snapTo('peek');
    }
  };

  const onBackdropClick = (): void => closeAllSheets();
  const onClose = (): void => {
    props.onClose?.();
    closeAllSheets();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') closeAllSheets();
  };

  onMount(() => {
    document.addEventListener('keydown', onKey);
    onCleanup(() => document.removeEventListener('keydown', onKey));
  });

  const style = (): JSX.CSSProperties | undefined => {
    if (!dragging()) return undefined;
    return { transform: `translateY(${dragDelta()}px)`, transition: 'none' };
  };

  const onToggleExpand = (): void => {
    const current = currentSnap();
    if (current === 'full') snapTo('half');
    else snapTo('full');
  };

  // Content key drives the sheet-body fade-in animation. Changes
  // when the active tab inside the sheet switches (so Mixer → AI
  // cross-fades) or when the user reopens the sheet.
  const contentKey = (): string => `${currentSnap()}:${getActiveTab()}`;

  const snapTargetLabel = (s: SheetSnap | null): string => {
    if (s === null) return '';
    switch (s) {
      case 'closed': return 'закрыть';
      case 'peek':   return 'peek';
      case 'half':   return 'half';
      case 'full':   return 'full';
    }
  };

  return (
    <Show when={currentSnap() !== 'closed'}>
      <div class="wc-sheet-backdrop" data-open="true" onClick={onBackdropClick} aria-hidden="true" />
      <div
        class="wc-sheet"
        data-snap={currentSnap()}
        data-snap-target={snapTarget() ?? ''}
        data-kind={props.kind}
        style={style()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="dialog"
        aria-modal={isMobileViewport() ? 'false' : 'true'}
        aria-label={props.title}
      >
        {/* Top-handle: drag-affordance + snap-points indicator +
            snap-feedback pill (latter visible only during drag). */}
        <Show when={isMobileViewport()}>
          <div
            class="wc-sheet__top-handle"
            data-no-drag="false"
            aria-hidden="true"
          >
            <div class="wc-sheet__snap-points" aria-hidden="true">
              <span class="wc-sheet__snap-point" data-snap-id="peek" />
              <span class="wc-sheet__snap-point" data-snap-id="half" />
              <span class="wc-sheet__snap-point" data-snap-id="full" />
            </div>
            <Show when={dragging() && snapTarget() !== null}>
              <span
                class="wc-sheet__snap-feedback"
                role="status"
                aria-live="polite"
              >
                {snapTargetLabel(snapTarget())}
              </span>
            </Show>
          </div>
        </Show>
        <div class="wc-sheet__handle-area">
          <div class="wc-sheet__handle" />
        </div>
        <div class="wc-sheet__header">
          <h2 class="wc-sheet__title">{props.title}</h2>
          <Show when={props.subtitle}>
            <span class="wc-sheet__subtitle">{props.subtitle}</span>
          </Show>
          {/* Internal sheet tabs: secondary navigation between
              tools (Mixer/AI/Status/Step/Piano) when sheet is open.
              Hidden via CSS on desktop (no-op when no sheet open). */}
          <Show when={isMobileViewport()}>
            <SheetTabs />
          </Show>
          <div class="wc-sheet__actions">
            <button
              type="button"
              class="wc-icon-btn"
              data-tone="ghost"
              data-no-drag="true"
              onClick={onToggleExpand}
              aria-label={currentSnap() === 'full' ? 'Свернуть' : 'Развернуть'}
              title={currentSnap() === 'full' ? 'Свернуть (handle ↑)' : 'Развернуть (handle ↓)'}
            >
              {currentSnap() === 'full' ? <CollapseIcon size={16} /> : <ExpandIcon size={16} />}
            </button>
            <button
              type="button"
              class="wc-icon-btn"
              data-tone="ghost"
              data-no-drag="true"
              onClick={onClose}
              aria-label="Закрыть"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
        <div
          class={`wc-sheet__body ${props.scrollBody ? 'wc-sheet__body--scroll' : ''}`}
          data-no-drag="true"
          data-content-key={contentKey()}
          ref={contentRef}
        >
          {props.children}
        </div>
      </div>
    </Show>
  );
}
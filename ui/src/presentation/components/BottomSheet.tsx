import {
  type JSX, type ParentProps, createSignal, onCleanup, onMount, Show,
} from 'solid-js';
import { CloseIcon, ExpandIcon, CollapseIcon } from '../icons';
import { closeAllSheets, snapTo, getKindSnap, type SheetKind, type SheetSnap } from '../state/uiState';

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
 * Mobile:    bottom sheet, snap = closed | peek(60%) | half(40%) | full(0)
 * Desktop ≥1024px: right-side drawer, snap = closed | open (width 480/720)
 *
 * Drag реализован на pointer events; snap выбирается по release-velocity
 * + position. Tap на handle-area или header toggle-ит snap (full ↔ half);
 * кнопка expand/collapse в шапке даёт явный affordance.
 */
export function BottomSheet(props: Props): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const [dragDelta, setDragDelta] = createSignal(0);
  let startY = 0;
  let startTime = 0;
  let contentRef: HTMLDivElement | undefined;
  let didDrag = false;

  const onPointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement | null)?.closest('[data-no-drag="true"]')) return;
    setDragging(true);
    didDrag = false;
    startY = e.clientY;
    startTime = Date.now();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging()) return;
    const dy = e.clientY - startY;
    if (Math.abs(dy) > TAP_THRESHOLD_PX) didDrag = true;
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

  const currentSnap = (): SheetSnap => getKindSnap(props.kind);

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

  return (
    <Show when={currentSnap() !== 'closed'}>
      <div class="wc-sheet-backdrop" data-open="true" onClick={onBackdropClick} aria-hidden="true" />
      <div
        class="wc-sheet"
        data-snap={currentSnap()}
        data-kind={props.kind}
        style={style()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="dialog"
        aria-modal="true"
        aria-label={props.title}
      >
        <div class="wc-sheet__handle-area">
          <div class="wc-sheet__handle" />
        </div>
        <div class="wc-sheet__header">
          <h2 class="wc-sheet__title">{props.title}</h2>
          <Show when={props.subtitle}>
            <span class="wc-sheet__subtitle">{props.subtitle}</span>
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
          ref={contentRef}
        >
          {props.children}
        </div>
      </div>
    </Show>
  );
}

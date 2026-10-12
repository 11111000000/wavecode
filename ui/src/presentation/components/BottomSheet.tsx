import {
  type JSX, type ParentProps, createSignal, onCleanup, onMount, Show,
} from 'solid-js';
import { CloseIcon } from '../icons';
import { closeAllSheets, snapTo, getKindSnap, type SheetKind, type SheetSnap } from '../state/uiState';

type Props = ParentProps<{
  kind: NonNullable<SheetKind>;
  title: string;
  subtitle?: string;
  initial?: SheetSnap;
  scrollBody?: boolean;
  onClose?: () => void;
}>;

/**
 * BottomSheet — draggable sheet с 3 snap-точками.
 * Mobile:    bottom sheet, snap = closed | peek(60%) | half(40%) | full(0)
 * Desktop ≥1024px: right-side drawer, snap = closed | open (width 480/720)
 *
 * Drag реализован на pointer events; snap выбирается по release-velocity
 * + position. Fallback: tap on handle toggles peek/full.
 */
export function BottomSheet(props: Props): JSX.Element {
  const [dragging, setDragging] = createSignal(false);
  const [dragDelta, setDragDelta] = createSignal(0);
  let startY = 0;
  let startTime = 0;
  let contentRef: HTMLDivElement | undefined;

  const onPointerDown = (e: PointerEvent): void => {
    if ((e.target as HTMLElement | null)?.closest('[data-no-drag]')) return;
    setDragging(true);
    startY = e.clientY;
    startTime = Date.now();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (!dragging()) return;
    const dy = e.clientY - startY;
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
        <div class="wc-sheet__handle-area" data-no-drag={false}>
          <div class="wc-sheet__handle" />
        </div>
        <div class="wc-sheet__header" data-no-drag={true}>
          <h2 class="wc-sheet__title">{props.title}</h2>
          <Show when={props.subtitle}>
            <span class="wc-sheet__subtitle">{props.subtitle}</span>
          </Show>
          <div class="wc-sheet__actions" data-no-drag={true}>
            <button
              type="button"
              class="wc-icon-btn"
              data-tone="ghost"
              onClick={onClose}
              aria-label="Закрыть"
            >
              <CloseIcon size={16} />
            </button>
          </div>
        </div>
        <div
          class={`wc-sheet__body ${props.scrollBody ? 'wc-sheet__body--scroll' : ''}`}
          data-no-drag={true}
          ref={contentRef}
        >
          {props.children}
        </div>
      </div>
    </Show>
  );
}

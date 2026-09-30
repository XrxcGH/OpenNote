// Pointer drag for the trees (ARCHITECTURE.md section 13.6), built on Pointer Events with pointer capture, so one
// path serves mouse, pen, and touch. A mouse starts after 4 px and a pen after 8 px. Touch starts after a 500 ms
// press: moving more than 8 px then drags, and releasing without moving opens the context menu. A swipe without
// the press scrolls. The dragged row lifts and follows the pointer with transform in an animation frame, a label
// says what will happen, and Escape cancels. Every drag has a single-pointer alternative in the row's menu.

import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../../strings/t';
import { tokens } from '../../theme/tokens';
import { blockOf, titleOf } from './actions';
import { dragStore, findRowElement, geometryOf, hostAt, hostFor } from './dragState';
import type { DragHost } from './dragState';
import { resolveDrop, rowAt } from './drop';
import type { Drop } from './drop';
import { dropNode } from './movement';
import { setOpen } from './navigation';
import type { Row } from './rows';
import type { TreeId } from './store';
import { settle } from './settle';
import { treeStore } from './store';
import styles from './Tree.module.css';

type PointerType = 'mouse' | 'pen' | 'touch';
const SLOP: Record<PointerType, number> = { mouse: 4, pen: 8, touch: 8 };
/** A collapsed container under the pointer opens after this long. */
export const EXPAND_MS = 700;
/** The fastest auto-scroll, in pixels per frame, at the very edge of a tree. */
const MAX_SCROLL = 18;
/** The click that follows a drop is swallowed for this long. */
const CLICK_GUARD_MS = 60;
/** A late context menu event from a long press is swallowed for this long after the press ends. */
const MENU_GUARD_MS = 400;

interface Hit {
  readonly host: DragHost | null;
  readonly row: Row | null;
  readonly drop: Drop | null;
}

interface Session {
  readonly env: DragHost;
  readonly pointerId: number;
  readonly type: PointerType;
  readonly start: { readonly x: number; readonly y: number };
  readonly row: Row;
  readonly element: HTMLElement;
  pointer: { x: number; y: number };
  phase: 'pending' | 'armed' | 'dragging';
  drop: Drop | null;
  shown: HTMLElement | null;
  label: HTMLElement | null;
  /** A copy of the row that follows the pointer above both trees; the real row stays, dimmed, in its place. */
  ghost: HTMLElement | null;
  origin: DOMRect | null;
  expanding: { id: string; timer: ReturnType<typeof setTimeout> } | null;
  press: ReturnType<typeof setTimeout> | null;
  frame: number;
  stop: (() => void)[];
  release(): void;
}

let justDragged = false;

function listen<K extends keyof WindowEventMap>(
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options: AddEventListenerOptions,
): () => void {
  window.addEventListener(type, listener, options);
  return () => window.removeEventListener(type, listener, options);
}

function offsetOf(session: Session) {
  return { x: session.pointer.x - session.start.x, y: session.pointer.y - session.start.y };
}

function hitAt(session: Session): Hit {
  const { x, y } = session.pointer;
  const host = hostAt(x, y);
  const geometry = host && geometryOf(host);
  const at = host && geometry ? rowAt(y, geometry) : null;
  const row = host && at ? (host.rows()[at.index] ?? null) : null;
  const drop = row && at ? resolveDrop(treeStore.get(), session.row.node, row, at.fraction) : null;
  return { host, row, drop };
}

function labelFor(session: Session, drop: Drop): string {
  const { node } = session.row;
  const target = titleOf(drop.target);
  return node.kind === 'page'
    ? t('tree.moves.dragPages', { count: blockOf(treeStore.get(), node.id).length, target })
    : t('tree.moves.dragItem', { title: titleOf(node), target });
}

/** Marks the row the drop would land on, and opens a collapsed container that the pointer rests on. */
function showTarget(session: Session, { row, drop }: Hit): void {
  const changed = drop?.rowId !== session.drop?.rowId || drop?.zone !== session.drop?.zone;
  session.drop = drop;
  document.documentElement.style.cursor = drop ? 'grabbing' : 'not-allowed';
  if (session.label) {
    session.label.hidden = !drop;
    if (drop && changed) session.label.textContent = labelFor(session, drop);
  }
  if (!changed) return;
  session.shown?.removeAttribute('data-drop');
  if (session.expanding) clearTimeout(session.expanding.timer);
  session.expanding = null;
  session.shown = drop ? findRowElement(drop.rowId) : null;
  if (drop) session.shown?.setAttribute('data-drop', drop.zone);
  if (drop?.zone === 'into' && row && row.expanded === false) {
    const id = row.id;
    session.expanding = { id, timer: setTimeout(() => setOpen('notebooks', [id], true), EXPAND_MS) };
  }
}

/** Scrolls the tree under the pointer when the pointer is in a 28 px strip at its top or bottom. Faster nearer the edge. */
function autoScroll(session: Session, host: DragHost | null): boolean {
  const container = host?.container();
  if (!container) return false;
  const rect = container.getBoundingClientRect();
  const strip = tokens.size.autoScrollStrip;
  const top = session.pointer.y - rect.top;
  const bottom = rect.bottom - session.pointer.y;
  const speed = top < strip ? -(1 - Math.max(0, top) / strip) : bottom < strip ? 1 - Math.max(0, bottom) / strip : 0;
  if (speed === 0) return false;
  container.scrollTop += speed * MAX_SCROLL;
  return true;
}

function schedule(session: Session): void {
  if (session.frame) return;
  session.frame = requestAnimationFrame(() => {
    session.frame = 0;
    const { x, y } = offsetOf(session);
    if (session.ghost) session.ghost.style.transform = `translate(${x}px, ${y}px)`;
    if (session.label)
      session.label.style.transform = `translate(${session.pointer.x + 14}px, ${session.pointer.y + 14}px)`;
    const found = hitAt(session);
    showTarget(session, found);
    if (autoScroll(session, found.host)) schedule(session);
  });
}

/** Undoes everything a session set up, except the lifted look, which the settle animation removes. */
function teardown(session: Session): void {
  if (session.press) clearTimeout(session.press);
  if (session.frame) cancelAnimationFrame(session.frame);
  session.shown?.removeAttribute('data-drop');
  if (session.expanding) clearTimeout(session.expanding.timer);
  session.label?.remove();
  session.stop.forEach((stop) => stop());
  if (session.phase === 'dragging') {
    dragStore.set({ id: null });
    delete document.documentElement.dataset.dragging;
    document.documentElement.style.cursor = '';
  }
  session.release();
}

/** A copy of a row for the pointer to carry: no ids, and hidden from assistive technology and from focus. */
function makeGhost(element: HTMLElement, origin: DOMRect): HTMLElement {
  const ghost = element.cloneNode(true) as HTMLElement;
  for (const node of [ghost, ...ghost.querySelectorAll<HTMLElement>('[id], [data-node-id]')]) {
    node.removeAttribute('id');
    node.removeAttribute('data-node-id');
  }
  for (const name of ['role', 'aria-labelledby', 'aria-describedby', 'tabindex', 'data-windowed']) {
    ghost.removeAttribute(name);
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.classList.add(styles.ghost);
  Object.assign(ghost.style, {
    left: `${origin.left}px`,
    top: `${origin.top}px`,
    width: `${origin.width}px`,
    height: `${origin.height}px`,
  });
  return ghost;
}

function begin(session: Session): void {
  session.phase = 'dragging';
  try {
    session.element.setPointerCapture(session.pointerId);
  } catch {
    // The pointer has already gone; the drop will be canceled by its pointercancel.
  }
  dragStore.set({ id: session.row.id });
  document.documentElement.dataset.dragging = '';
  session.origin = session.element.getBoundingClientRect();
  session.ghost = document.body.appendChild(makeGhost(session.element, session.origin));
  session.element.classList.add(styles.dragSource);
  const label = document.createElement('div');
  label.className = styles.dragLabel;
  label.setAttribute('aria-hidden', 'true');
  label.hidden = true;
  session.label = document.body.appendChild(label);
  session.stop.push(
    listen(
      'keydown',
      (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        finish(session, false);
      },
      { capture: true },
    ),
  );
  schedule(session);
}

/** The drop, or the cancel: the copy settles into the row's new place, or back where it was, with the spring. */
function finish(session: Session, commit: boolean): void {
  const { element, drop, ghost } = session;
  const offset = offsetOf(session);
  const visual = ghost?.getBoundingClientRect();
  teardown(session);
  justDragged = true;
  setTimeout(() => (justDragged = false), CLICK_GUARD_MS);
  const done =
    (...rows: HTMLElement[]) =>
    () => {
      ghost?.remove();
      for (const row of rows) row.classList.remove(styles.dragSource);
    };
  if (!ghost || !visual) return done(element)();
  if (!commit || !drop) {
    settle(ghost, offset, done(element));
    return;
  }
  void dropNode(session.env.notes, session.row.node, drop);
  // The store has changed, and React renders at the end of this event, before the next paint.
  queueMicrotask(() => {
    const moved = findRowElement(session.row.id);
    if (!moved) return done(element)();
    moved.classList.add(styles.dragSource);
    const now = moved.getBoundingClientRect();
    Object.assign(ghost.style, { left: `${now.left}px`, top: `${now.top}px` });
    settle(ghost, { x: visual.left - now.left, y: visual.top - now.top }, done(element, moved));
  });
}

function arm(session: Session): void {
  // A long press also raises a context menu on some platforms; the menu waits for the release instead.
  const stop = listen(
    'contextmenu',
    (event) => {
      event.preventDefault();
      event.stopPropagation();
    },
    { capture: true },
  );
  session.stop.push(() => setTimeout(stop, MENU_GUARD_MS));
  session.press = setTimeout(() => {
    session.press = null;
    if (session.phase !== 'pending') return;
    session.phase = 'armed';
    session.stop.push(
      listen('touchmove', (event) => void (event.cancelable && event.preventDefault()), { passive: false }),
    );
  }, tokens.interaction.longPressMs);
}

function rowUnder(event: ReactPointerEvent, rows: readonly Row[]) {
  const target = event.target as Element;
  if (target.closest('button, input, [data-twisty]')) return null;
  const element = target.closest<HTMLElement>('[role="treeitem"]');
  const row = rows.find((candidate) => candidate.id === element?.dataset.nodeId);
  return element && row && !row.node.readOnly ? { row, element } : null;
}

/** The pointer handlers for a tree's container, working with whatever the tree last registered. */
export function createDragHandlers(tree: TreeId) {
  let session: Session | null = null;
  const own = (event: ReactPointerEvent) => (session?.pointerId === event.pointerId ? session : null);
  return {
    onPointerDown(event: ReactPointerEvent) {
      const current = hostFor(tree);
      const found = current && rowUnder(event, current.rows());
      const primary = event.isPrimary && (event.pointerType !== 'mouse' || event.button === 0);
      if (!current || session || !primary || !found) return;
      const start = { x: event.clientX, y: event.clientY };
      session = {
        env: current,
        pointerId: event.pointerId,
        type: event.pointerType === 'touch' || event.pointerType === 'pen' ? event.pointerType : 'mouse',
        start,
        pointer: { ...start },
        ...found,
        phase: 'pending',
        drop: null,
        shown: null,
        label: null,
        ghost: null,
        origin: null,
        expanding: null,
        press: null,
        frame: 0,
        stop: [],
        release: () => void (session = null),
      };
      if (session.type === 'touch') arm(session);
    },
    onPointerMove(event: ReactPointerEvent) {
      const active = own(event);
      if (!active) return;
      active.pointer = { x: event.clientX, y: event.clientY };
      if (active.phase === 'dragging') return schedule(active);
      const moved = Math.hypot(active.pointer.x - active.start.x, active.pointer.y - active.start.y);
      if (moved <= SLOP[active.type]) return;
      // A finger that moves before the press is a swipe, and the browser scrolls.
      if (active.type === 'touch' && active.phase === 'pending') teardown(active);
      else begin(active);
    },
    onPointerUp(event: ReactPointerEvent) {
      const active = own(event);
      if (!active) return;
      const { phase, row, element, env: host } = active;
      if (phase === 'dragging') return finish(active, true);
      teardown(active);
      if (phase !== 'armed') return;
      justDragged = true;
      setTimeout(() => (justDragged = false), CLICK_GUARD_MS);
      host.openMenu(row, { x: event.clientX, y: event.clientY }, element);
    },
    onPointerCancel(event: ReactPointerEvent) {
      const active = own(event);
      if (!active) return;
      if (active.phase === 'dragging') finish(active, false);
      else teardown(active);
    },
    /** The click that follows a drop or a long press would select or open the row. */
    onClickCapture(event: MouseEvent) {
      if (!justDragged) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}

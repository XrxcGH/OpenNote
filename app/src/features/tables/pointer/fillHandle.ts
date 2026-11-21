// The fill handle and the menu after a drop (DESIGN.md sections 12 and 13.6). Dragging the handle previews the new
// box and fills on release (Ctrl copies). The menu then offers Copy cells, Fill series, Fill formatting only, and
// Fill without formatting, each of which writes over the cells again from their first content.
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { namesFor } from '../engine/series';
import { gridOf } from '../keys/state';
import { appLocale } from '../smart/locale';
import { fill, restoreFormats } from './actions';
import type { FillDrop } from './actions';
import type { PointerContext } from './context';
import { drag } from './drag';
import { targetOf } from './fill';
import type { FillMode } from './fill';
import styles from './pointer.module.css';

const seriesOptions = () => ({ names: namesFor(appLocale().tag) });

const MODES: readonly (readonly [FillMode, MessageKey])[] = [
  ['copy', 'sheetPointer.fill.copy'],
  ['series', 'sheetPointer.fill.series'],
  ['formats', 'sheetPointer.fill.formats'],
  ['values', 'sheetPointer.fill.values'],
];

type Box = { top: number; left: number; bottom: number; right: number };

function showPreview(ctx: PointerContext, box: Box | null): void {
  const { preview } = ctx.els;
  const a = box && ctx.geo.cellElement({ row: box.top, column: box.left });
  const b = box && ctx.geo.cellElement({ row: box.bottom, column: box.right });
  preview.hidden = !a || !b;
  if (!a || !b) return;
  const from = ctx.geo.local(a.getBoundingClientRect());
  const to = ctx.geo.local(b.getBoundingClientRect());
  Object.assign(preview.style, {
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${to.right - from.left}px`,
    height: `${to.bottom - from.top}px`,
  });
}

/** Arrows move between the choices, and Escape closes the menu and gives the table the focus back. */
function onMenuKey(ctx: PointerContext, menu: HTMLElement, event: KeyboardEvent, close: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    ctx.view.focus();
    return;
  }
  const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
  if (!step) return;
  event.preventDefault();
  const buttons = Array.from(menu.querySelectorAll('button'));
  const at = buttons.indexOf(ctx.doc.activeElement as HTMLButtonElement);
  buttons[(at + step + buttons.length) % buttons.length]?.focus();
}

/** The menu after a drop. */
function createMenu(ctx: PointerContext, choose: (drop: FillDrop, mode: FillMode) => void) {
  let menu: HTMLElement | null = null;
  const close = () => {
    menu?.remove();
    menu = null;
  };
  const open = (drop: FillDrop, mode: FillMode) => {
    close();
    const last = ctx.geo.cellElement({ row: drop.box.bottom, column: drop.box.right });
    if (!last) return;
    const at = last.getBoundingClientRect();
    // In the page, not the table, which clips what hangs below it.
    const el = ctx.doc.body.appendChild(ctx.doc.createElement('div'));
    menu = el;
    el.className = styles.menu;
    el.setAttribute('role', 'menu');
    el.setAttribute('aria-label', t('sheetPointer.fill.menu'));
    el.style.left = `${Math.max(8, Math.min(at.right, window.innerWidth - 220))}px`;
    el.style.top = `${at.bottom + 8}px`;
    for (const [id, label] of MODES) {
      const button = el.appendChild(ctx.doc.createElement('button'));
      button.type = 'button';
      button.setAttribute('role', 'menuitemradio');
      button.setAttribute('aria-checked', String(id === mode));
      button.textContent = t(label);
      button.addEventListener('click', () => choose(drop, id));
    }
    el.addEventListener('keydown', (event) => onMenuKey(ctx, el, event, close));
    // The focus stays in the table, so Ctrl+Z right after a drop undoes the fill. Alt+Down moves into the menu.
  };
  const focus = () => {
    const buttons = Array.from(menu?.querySelectorAll('button') ?? []);
    (buttons.find((b) => b.getAttribute('aria-checked') === 'true') ?? buttons[0])?.focus();
  };
  return { open, close, focus, isOpen: () => menu !== null, contains: (node: Node) => menu?.contains(node) ?? false };
}

export interface FillControl {
  /** Moves the focus into the menu after a drop, when one is open. */
  focus(): void;
  /** Fills the selection as a series, down from its first row or right from its first column. */
  fillSeries(direction: 'down' | 'right'): void;
  stop(): void;
  close(): void;
  isOpen(): boolean;
}

/** Attaches the fill handle. */
export function attachFill(ctx: PointerContext): FillControl {
  const { view, host, els } = ctx;
  const menu = createMenu(ctx, (drop, mode) => void again(drop, mode));
  /** A choice in the menu: the formats go back, then the chosen kind of fill writes over the cells. */
  async function again(drop: FillDrop, mode: FillMode) {
    menu.close();
    await restoreFormats(host, drop);
    const next = await fill(view, host, drop, mode, seriesOptions(), drop);
    menu.open(next, mode);
    ctx.place();
  }
  function onDown(event: PointerEvent) {
    const g = gridOf(view.state);
    if (event.button !== 0 || !g) return;
    ctx.touch = event.pointerType === 'touch';
    menu.close();
    const source = g.box;
    let target: ReturnType<typeof targetOf> = null;
    const move = (e: PointerEvent) => {
      const over = ctx.geo.cellAtPoint(e.clientX, e.clientY);
      target = over ? targetOf(source, over) : null;
      showPreview(ctx, target?.box ?? null);
    };
    const done = (e: PointerEvent, canceled: boolean) => {
      showPreview(ctx, null);
      if (!target || canceled) return;
      // Ctrl while dragging copies instead of continuing the series.
      const mode: FillMode = e.ctrlKey || e.metaKey ? 'copy' : 'series';
      const { box, direction } = target;
      void fill(view, host, { source, box, direction }, mode, seriesOptions()).then((drop) => {
        menu.open(drop, mode);
        host.announce(t('sheetPointer.fill.menuOpen'));
        ctx.place();
      });
    };
    drag(els.fill, event, move, done);
  }
  els.fill.addEventListener('pointerdown', onDown);
  /** The keyboard's way to the same fill: the first row (or column) of the selection into the rest. */
  function fillSeries(direction: 'down' | 'right') {
    const g = gridOf(view.state);
    const box = g?.box;
    const down = direction === 'down';
    if (!box || (down ? box.top === box.bottom : box.left === box.right)) {
      host.announce(t('sheetPointer.fill.nothing'));
      return;
    }
    const source = down ? { ...box, bottom: box.top } : { ...box, right: box.left };
    menu.close();
    void fill(view, host, { source, box, direction }, 'series', seriesOptions());
  }
  // A press anywhere else closes the menu: its choices belong to the fill that was just made.
  const outside = (event: Event) => {
    const node = event.target;
    if (node instanceof Node && menu.isOpen() && !menu.contains(node) && node !== els.fill) menu.close();
  };
  ctx.doc.addEventListener('pointerdown', outside, true);
  return {
    stop() {
      els.fill.removeEventListener('pointerdown', onDown);
      ctx.doc.removeEventListener('pointerdown', outside, true);
      menu.close();
    },
    close: menu.close,
    isOpen: menu.isOpen,
    focus: menu.focus,
    fillSeries,
  };
}

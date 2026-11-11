// The formatting bar (ARCHITECTURE.md section 22.6; owner: WP4). After a touch or pen selection in a text box,
// or any selection with the setting at Always, a small toolbar appears above the selection, or below it when
// there's no room. It holds Bold, Italic, Highlight, Link, and More, with 44 px targets, in the top layer.
//
// Escape, scrolling, or a tap elsewhere closes it. Arrow keys move between its buttons, and the editor keeps the
// selection, because pressing a button never takes focus from the text.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { isEnabled } from '../../../app/flags';
import { executeCommand } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import { commands } from '../../../registries';
import { getSizeClass } from '../../../state/layout';
import { t } from '../../../strings/t';
import { openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import styles from './bar.module.css';

const BUTTONS: readonly CommandId[] = ['format.bold', 'format.italic', 'format.highlight', 'format.link'];
// Beta 10 (text.v2Controls): two rows, as Word's mini toolbar has. The compact class keeps one row and adds Aa.
const ROW_FONT: readonly CommandId[] = ['format.growFont', 'format.shrinkFont', 'format.painter', 'styles.apply'];
const ROW_FORMAT: readonly CommandId[] = [
  'format.bold',
  'format.italic',
  'format.underline',
  'format.highlight',
  'format.textColor',
  'block.bulletList',
  'block.orderedList',
  'format.link',
];
const ROW_COMPACT: readonly CommandId[] = [
  'format.bold',
  'format.italic',
  'format.underline',
  'format.highlight',
  'format.textColor',
  'text.compactSheet',
];
const MORE: readonly CommandId[] = [
  'format.underline',
  'format.strike',
  'format.code',
  'format.textColor',
  'format.clear',
  'block.turnInto',
];
/** Buttons that leave the bar open: they change the text and the selection stays. */
const KEEP_OPEN: ReadonlySet<string> = new Set([
  'format.growFont',
  'format.shrinkFont',
  'format.bold',
  'format.italic',
  'format.underline',
  'block.bulletList',
  'block.orderedList',
]);
/** The gap between the selection and the bar. */
const GAP = 8;

let open: { close(): void } | null = null;

function label(id: CommandId): string {
  const def = commands.get(id);
  return def ? t(def.title) : id;
}

function moreItems(): MenuItemSpec[] {
  return MORE.filter((id) => commands.get(id)).map((id) => ({
    id,
    label: label(id),
    onSelect: () => void executeCommand(id, undefined, 'commandBar'),
  }));
}

function makeButton(text: string, onPress: (element: HTMLButtonElement) => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = styles.button;
  element.textContent = text;
  element.tabIndex = -1;
  // Pressing a button keeps focus, and so the selection, in the text.
  element.addEventListener('pointerdown', (event) => event.preventDefault());
  element.addEventListener('click', () => onPress(element));
  return element;
}

function commandButton(id: CommandId, onPress: () => void): HTMLButtonElement {
  const element = makeButton(id === 'text.compactSheet' ? t('textHome.sheet.open') : label(id), onPress);
  element.dataset.command = id;
  if (id === 'text.compactSheet') element.setAttribute('aria-label', t('textHome.sheet.label'));
  const checked = commands.get(id)?.checked;
  if (checked) element.setAttribute('aria-pressed', String(checked({} as never)));
  return element;
}

/** A command that exists and whose flag is on. */
function usable(id: CommandId): boolean {
  const def = commands.get(id);
  return def !== undefined && (!def.flag || isEnabled(def.flag));
}

function makeRow(labelKey: 'textHome.mini.row1' | 'textHome.mini.row2'): HTMLElement {
  const row = document.createElement('div');
  row.className = styles.row;
  row.setAttribute('role', 'group');
  row.setAttribute('aria-label', t(labelKey));
  return row;
}

/** Above the selection, or below it when the bar wouldn't fit above. */
function place(bar: HTMLElement, rect: DOMRect): void {
  const height = bar.getBoundingClientRect().height || 44;
  const above = rect.top - height - GAP;
  bar.style.insetBlockStart = `${above >= 0 ? above : rect.bottom + GAP}px`;
  bar.style.insetInlineStart = `${Math.max(GAP, rect.left)}px`;
  bar.dataset.placement = above >= 0 ? 'above' : 'below';
}

/** Arrow keys move between the bar's buttons; Escape closes it. */
function onKey(bar: HTMLElement, event: KeyboardEvent, close: () => void): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
    return;
  }
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...bar.querySelectorAll<HTMLButtonElement>('button')];
  const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  event.preventDefault();
  const last = buttons.length - 1;
  const next = { ArrowLeft: at - 1, ArrowRight: at + 1, Home: 0, End: last }[event.key] ?? at;
  buttons[(next + buttons.length) % buttons.length].focus();
}

/** Shows the bar for the selection at `rect`. Opening another closes this one. */
export function showFormattingBar(rect: DOMRect): { close(): void } {
  open?.close();
  const bar = document.createElement('div');
  bar.className = styles.bar;
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', t('editor.bar.label'));
  bar.setAttribute('popover', 'manual');
  const close = () => {
    (boxes as Root | null)?.unmount();
    bar.remove();
    document.removeEventListener('keydown', escape, true);
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('scroll', close, true);
    if (open === handle) open = null;
  };
  const run = (id: CommandId) => () => {
    void executeCommand(id, undefined, 'commandBar');
    // Format buttons keep the bar open, so the next one is a press away; the others close it.
    if (!(isEnabled('text.v2Controls') && KEEP_OPEN.has(id))) close();
  };
  const more = makeButton(t('editor.bar.more'), async (element) => {
    const chosen = await openMenu({ label: t('editor.bar.more'), items: moreItems(), anchor: element });
    if (chosen) close();
  });
  more.setAttribute('aria-haspopup', 'menu');
  let boxes: Root | null = null;
  const press = (id: CommandId) => commandButton(id, run(id));
  const buttons: HTMLButtonElement[] = [];
  if (isEnabled('text.v2Controls') && getSizeClass() === 'compact') {
    const row = makeRow('textHome.mini.row2');
    buttons.push(...ROW_COMPACT.filter(usable).map(press));
    row.append(...buttons, more);
    bar.append(row);
  } else if (isEnabled('text.v2Controls')) {
    const first = makeRow('textHome.mini.row1');
    const holder = document.createElement('span');
    holder.className = styles.boxes;
    first.append(holder);
    const fontButtons = ROW_FONT.filter(usable).map(press);
    first.append(...fontButtons);
    const second = makeRow('textHome.mini.row2');
    const formatButtons = ROW_FORMAT.filter(usable).map(press);
    second.append(...formatButtons, more);
    bar.append(first, second);
    buttons.push(...formatButtons, ...fontButtons);
    // The font and size boxes are the Home tab's own, so they load with the first press on the bar.
    void import('../homeTab/tools').then(({ FontBox, SizeControl }) => {
      if (open !== handle) return;
      boxes = createRoot(holder);
      boxes.render(
        createElement('span', { className: styles.boxes }, createElement(FontBox), createElement(SizeControl)),
      );
    });
  } else {
    const row = makeRow('textHome.mini.row2');
    buttons.push(...BUTTONS.filter((id) => commands.get(id)).map(press));
    row.append(...buttons, more);
    bar.append(row);
  }
  bar.addEventListener('keydown', (event) => onKey(bar, event, close));
  const escape = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && !bar.contains(event.target as Node)) close();
  };
  const outside = (event: PointerEvent) => {
    if (!bar.contains(event.target as Node)) close();
  };
  document.body.append(bar);
  (bar as HTMLElement & { showPopover?(): void }).showPopover?.();
  place(bar, rect);
  document.addEventListener('keydown', escape, true);
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', close, true);
  const handle = { close };
  open = handle;
  return handle;
}

/** Closes the bar, if it's open. */
export function closeFormattingBar(): void {
  open?.close();
}

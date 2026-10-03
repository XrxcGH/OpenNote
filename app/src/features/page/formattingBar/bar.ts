// The formatting bar (ARCHITECTURE.md section 22.6; owner: WP4). After a touch or pen selection in a text box,
// or any selection with the setting at Always, a small toolbar appears above the selection, or below it when
// there's no room. It holds Bold, Italic, Highlight, Link, and More, with 44 px targets, in the top layer.
//
// Escape, scrolling, or a tap elsewhere closes it. Arrow keys move between its buttons, and the editor keeps the
// selection, because pressing a button never takes focus from the text.
import { executeCommand } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import { commands } from '../../../registries';
import { t } from '../../../strings/t';
import { openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import styles from './bar.module.css';

const BUTTONS: readonly CommandId[] = ['format.bold', 'format.italic', 'format.highlight', 'format.link'];
const MORE: readonly CommandId[] = [
  'format.underline',
  'format.strike',
  'format.code',
  'format.textColor',
  'format.clear',
  'block.turnInto',
];
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
  const element = makeButton(label(id), onPress);
  element.dataset.command = id;
  const checked = commands.get(id)?.checked;
  if (checked) element.setAttribute('aria-pressed', String(checked({} as never)));
  return element;
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
    bar.remove();
    document.removeEventListener('keydown', escape, true);
    document.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('scroll', close, true);
    if (open === handle) open = null;
  };
  const run = (id: CommandId) => () => {
    void executeCommand(id, undefined, 'commandBar');
    close();
  };
  const more = makeButton(t('editor.bar.more'), async (element) => {
    const chosen = await openMenu({ label: t('editor.bar.more'), items: moreItems(), anchor: element });
    if (chosen) close();
  });
  more.setAttribute('aria-haspopup', 'menu');
  const buttons = BUTTONS.filter((id) => commands.get(id)).map((id) => commandButton(id, run(id)));
  bar.append(...buttons, more);
  buttons[0]?.setAttribute('tabindex', '0');
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

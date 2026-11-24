// Copy, cut, and paste in a table block's editor (ADR 0067). The table extra (register.ts) loads this when the
// block's editor mounts. Its copy, cut, and paste listen on the document's capture phase (listenFirst), so they run
// before the page's listeners and the editor's, and the page's code needs no table-cell hook:
// - Copy and cut of selected cells write the three forms of copy.ts. Cut then clears the cells, formats included.
// - A paste of cells (an HTML table, tab-separated text, or OpenNote's own form) lands at the selected cells with
//   values, formulas, formats, and merges. With the caret in a cell (Edit mode), a paste stays ordinary text.
// - Ctrl+Shift+V pastes values only. Ctrl+Alt+V (register.ts) opens Paste special.
// Each paste is one undo step: the rows and the sheet patch go through the host's `apply`.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import { newId } from '../../../editor/ids';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui/toast';
import type { TableExtraHandle, TableExtraHost } from '../../page';
import { readClip } from '../engine/paste/clip';
import { MAX_COLUMNS, MAX_ROWS } from '../engine/paste/infer';
import type { Clip } from '../engine/paste/clip';
import { boxOfSelection, selectBox } from '../sheet/formatTarget';
import { readSheet, tableName } from '../sheet/model';
import type { Box } from '../sheet/model';
import { appLocale } from '../smart/locale';
import { copyCells } from './copy';
import { modeOf, type SheetMode } from '../keys/state';
import { planCut, planPaste, type PastePlan, type PasteReport } from './plan';
import { PASTE_ALL, PASTE_VALUES, type PasteSpecial } from './special';

const key = new PluginKey('sheetClipboard');

/** The last cells this window copied, for Paste special when the system clipboard cannot be read. */
let lastCopy: { html: string; text: string } | null = null;

const cellCount = (box: Box): number => (box.bottom - box.top + 1) * (box.right - box.left + 1);

function copySelection(host: TableExtraHost, view: EditorView, data: DataTransfer | null): Box | null {
  if (!(view.state.selection instanceof CellSelection) || !data) return null;
  const table = host.table();
  const box = boxOfSelection(view.state, table);
  if (!box) return null;
  const sheet = readSheet(host.data());
  const out = copyCells({
    table,
    sheet,
    box,
    locale: appLocale(),
    block: host.block,
    name: tableName(sheet),
    page: host.page,
  });
  data.setData('text/html', out.html);
  data.setData('text/plain', out.text);
  lastCopy = { html: out.html, text: out.text };
  return box;
}

/** Clears the cut cells' text, styles, notes, and merges, as one undo step. */
function clearBox(host: TableExtraHost, box: Box): void {
  const cut = planCut(host.table(), readSheet(host.data()), box);
  void host.apply(() => cut.table, cut.patch ?? undefined);
}

/** Whether a clip is one plain value, which a cell being edited takes as ordinary text. */
function isOneValue(clip: Clip): boolean {
  const cell = clip.rows[0][0];
  return clip.rows.length === 1 && clip.rows[0].length === 1 && !cell.formula && !cell.style;
}

/**
 * Whether the table's clipboard takes a paste. Grid mode (a cell selection) takes any cells. With the caret in a cell
 * (Edit mode), the text editor's meaning wins (DESIGN 13), as in a spreadsheet while editing. Plain text stays in the
 * cell, though it holds tabs or line breaks. Only a table copied from a spreadsheet lands as cells, outside Edit mode.
 */
export function takesPaste(cells: boolean, mode: SheetMode | null, clip: Clip): boolean {
  if (cells) return true;
  return mode !== 'edit' && clip.source !== 'delimited' && !isOneValue(clip);
}

function announceReport(host: TableExtraHost, report: readonly PasteReport[]): void {
  for (const item of report) host.announce(t(`sheetClipboard.announce.${item}`));
}

/** The message for the rows and columns a paste left out past the table's limits, or null when it kept them all. */
export function leftOutText(left: PastePlan['left']): string | null {
  const parts = [
    left.cols > 0 ? t('sheetClipboard.announce.leftColumns', { count: left.cols, max: MAX_COLUMNS }) : '',
    left.rows > 0 ? t('sheetClipboard.announce.leftRows', { count: left.rows, max: MAX_ROWS }) : '',
  ].filter((part) => part !== '');
  return parts.length > 0 ? parts.join(' ') : null;
}

/** Pastes a clip at the selection. Returns false when there is no table selection to paste into. */
async function pasteClip(host: TableExtraHost, view: EditorView, clip: Clip, special: PasteSpecial): Promise<boolean> {
  const table = host.table();
  const box = boxOfSelection(view.state, table);
  if (!box) return false;
  const target = { table, sheet: readSheet(host.data()), box, block: host.block, page: host.page };
  const plan = planPaste(target, clip, special, { newId });
  if (!plan) return false;
  // What was left out shows in a toast with the counts, so a large paste never loses cells without a word (walk 9
  // T4-D07-13). The toast speaks it too, so the general sentence is not announced as well.
  const leftOut = leftOutText(plan.left);
  if (leftOut) showToast({ id: 'sheet-paste-left-out', message: leftOut });
  announceReport(host, leftOut ? plan.report.filter((item) => item !== 'dropped') : plan.report);
  if (plan.report.includes('styles')) return true;
  const done = await host.apply(() => plan.table, plan.patch ?? undefined);
  if (done && !host.editor.isDestroyed) {
    selectBox(host.editor, plan.box);
    host.announce(t('sheetClipboard.announce.pasted', { cells: cellCount(plan.box) }));
  }
  return true;
}

/** The clipboard's HTML and text for Paste special: the system clipboard when it can be read, else the last copy. */
async function clipboardNow(): Promise<{ html: string | null; text: string | null } | null> {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const html = item.types.includes('text/html') ? await (await item.getType('text/html')).text() : null;
      const text = item.types.includes('text/plain') ? await (await item.getType('text/plain')).text() : null;
      if (html || text) return { html, text };
    }
  } catch {
    // The clipboard cannot be read here; the window's last copy stands in.
  }
  return lastCopy;
}

/** Paste special (Ctrl+Alt+V): asks how to paste the clipboard, then pastes at the selection. */
export async function pasteSpecial(host: TableExtraHost): Promise<void> {
  const { view } = host.editor;
  const content = await clipboardNow();
  const clip = content ? readClip(content) : null;
  if (!clip) {
    host.announce(t('sheetClipboard.special.empty'));
    return;
  }
  const { askSpecial } = await import('./SpecialDialog');
  const choice = await askSpecial(clip.link !== undefined);
  if (choice && !host.editor.isDestroyed) await pasteClip(host, view, clip, choice);
  if (!host.editor.isDestroyed) host.editor.view.focus();
}

type ClipboardKind = 'copy' | 'cut' | 'paste';

/**
 * Listens for copy, cut, and paste on the document's capture phase, so a handler runs before the page's own
 * listeners (on the page's container) and before the editor. A handler that takes the event (returns true) ends it
 * there: the page and the editor do not see it. So the page's code needs no table-cell hook. Returns a function that
 * stops listening.
 */
export function listenFirst(
  doc: Document,
  owns: (target: EventTarget | null) => boolean,
  handlers: Partial<Record<ClipboardKind, (event: ClipboardEvent) => boolean>>,
): () => void {
  const stops: (() => void)[] = [];
  for (const [kind, handle] of Object.entries(handlers)) {
    const listener = (event: Event) => {
      if (event.defaultPrevented || !owns(event.target)) return;
      if (!handle(event as ClipboardEvent)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    doc.addEventListener(kind, listener, true);
    stops.push(() => doc.removeEventListener(kind, listener, true));
  }
  return () => stops.forEach((stop) => stop());
}

/** The table's copy, cut, and paste. Each returns true when it took the event. */
function clipboardHandlers(host: TableExtraHost, valuesNext: () => boolean) {
  const view = (): EditorView => host.editor.view;
  return {
    copy(event: ClipboardEvent): boolean {
      const box = copySelection(host, view(), event.clipboardData);
      if (!box) return false;
      host.announce(t('sheetClipboard.announce.copied', { count: cellCount(box) }));
      return true;
    },
    cut(event: ClipboardEvent): boolean {
      if (!view().editable) return false;
      const box = copySelection(host, view(), event.clipboardData);
      if (!box) return false;
      clearBox(host, box);
      host.announce(t('sheetClipboard.announce.cut', { count: cellCount(box) }));
      return true;
    },
    paste(event: ClipboardEvent): boolean {
      const values = valuesNext();
      const data = event.clipboardData;
      const v = view();
      if (!data || !v.editable) return false;
      const clip = readClip({ html: data.getData('text/html'), text: data.getData('text/plain') });
      if (!clip) return false;
      if (!takesPaste(v.state.selection instanceof CellSelection, modeOf(v.state), clip)) return false;
      if (!boxOfSelection(v.state, host.table())) return false;
      void pasteClip(host, v, clip, values ? PASTE_VALUES : PASTE_ALL);
      return true;
    },
  };
}

/** Notes Ctrl+Shift+V, so the paste that follows pastes values only. */
export function sheetClipboardPlugin(state: { valuesNext: boolean }): Plugin {
  return new Plugin({
    key,
    props: {
      handleKeyDown(_view, event) {
        const v = event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey);
        state.valuesNext = v && event.shiftKey && !event.altKey;
        return false;
      },
    },
  });
}

export function attachSheetClipboard(host: TableExtraHost): TableExtraHandle {
  const keys = { valuesNext: false };
  const plugin = sheetClipboardPlugin(keys);
  host.editor.registerPlugin(plugin, (added, plugins) => [added, ...plugins]);
  const valuesNext = () => {
    const values = keys.valuesNext;
    keys.valuesNext = false;
    return values;
  };
  const owns = (target: EventTarget | null) => target instanceof Node && host.editor.view.dom.contains(target);
  const stop = listenFirst(host.element.ownerDocument, owns, clipboardHandlers(host, valuesNext));
  return {
    update() {},
    destroy() {
      stop();
      if (!host.editor.isDestroyed) host.editor.unregisterPlugin(key);
    },
  };
}

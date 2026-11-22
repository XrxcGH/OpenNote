// Copy, cut, and paste in a table block's editor (ADR 0067). The table extra (register.ts) loads this when the
// block's editor mounts and adds a plugin that runs before the table's own clipboard handling:
// - Copy and cut of selected cells write the three forms of copy.ts. Cut then clears the cells' text.
// - A paste of cells (an HTML table, tab-separated text, or OpenNote's own form) lands at the selection with values,
//   formulas, formats, and merges. One value pasted into a cell that is being edited stays an ordinary text paste.
// - Ctrl+Shift+V pastes values only. Ctrl+Alt+V opens Paste special.
// Each paste is one undo step: the rows and the sheet patch go through the host's `apply`.

import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { CellSelection } from '@tiptap/pm/tables';
import { newId } from '../../../editor/ids';
import { t } from '../../../strings/t';
import type { TableExtraHandle, TableExtraHost } from '../../page';
import { readClip } from '../engine/paste/clip';
import type { Clip } from '../engine/paste/clip';
import { boxOfSelection, selectBox } from '../sheet/formatTarget';
import { readSheet, tableName } from '../sheet/model';
import type { Box } from '../sheet/model';
import { appLocale } from '../smart/locale';
import { copyCells } from './copy';
import { planPaste, type PasteReport } from './plan';
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
  const out = copyCells({ table, sheet, box, locale: appLocale(), block: host.block, name: tableName(sheet) });
  data.setData('text/html', out.html);
  data.setData('text/plain', out.text);
  lastCopy = { html: out.html, text: out.text };
  return box;
}

/** Clears the text of the cut cells, as one undo step. */
function clearBox(host: TableExtraHost, box: Box): void {
  void host.apply((data) => ({
    ...data,
    rows: data.rows.map((row, r) =>
      r < box.top || r > box.bottom
        ? row
        : {
            ...row,
            cells: Object.fromEntries(
              Object.entries(row.cells).map(([id, cell]) => {
                const c = data.columns.findIndex((column) => column.id === id);
                return [id, c >= box.left && c <= box.right ? { ...cell, markdown: '' } : cell];
              }),
            ),
          },
    ),
  }));
}

/** Whether a clip is one plain value, which a cell being edited takes as ordinary text. */
function isOneValue(clip: Clip): boolean {
  const cell = clip.rows[0][0];
  return clip.rows.length === 1 && clip.rows[0].length === 1 && !cell.formula && !cell.style;
}

function announceReport(host: TableExtraHost, report: readonly PasteReport[]): void {
  for (const item of report) host.announce(t(`sheetClipboard.announce.${item}`));
}

/** Pastes a clip at the selection. Returns false when there is no table selection to paste into. */
async function pasteClip(host: TableExtraHost, view: EditorView, clip: Clip, special: PasteSpecial): Promise<boolean> {
  const table = host.table();
  const box = boxOfSelection(view.state, table);
  if (!box) return false;
  const plan = planPaste({ table, sheet: readSheet(host.data()), box, block: host.block }, clip, special, { newId });
  if (!plan) return false;
  announceReport(host, plan.report);
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

async function pasteSpecial(host: TableExtraHost, view: EditorView): Promise<void> {
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

export function sheetClipboardPlugin(host: TableExtraHost): Plugin {
  let valuesNext = false;
  return new Plugin({
    key,
    props: {
      handleKeyDown(view, event) {
        const v = event.key.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey);
        valuesNext = v && event.shiftKey && !event.altKey;
        if (v && event.altKey && !event.shiftKey) {
          void pasteSpecial(host, view);
          return true;
        }
        return false;
      },
      handleDOMEvents: {
        copy(view, event) {
          const box = copySelection(host, view, event.clipboardData);
          if (!box) return false;
          event.preventDefault();
          host.announce(t('sheetClipboard.announce.copied', { count: cellCount(box) }));
          return true;
        },
        cut(view, event) {
          const box = copySelection(host, view, event.clipboardData);
          if (!box) return false;
          event.preventDefault();
          clearBox(host, box);
          host.announce(t('sheetClipboard.announce.cut', { count: cellCount(box) }));
          return true;
        },
        paste(view, event) {
          const values = valuesNext;
          valuesNext = false;
          const data = event.clipboardData;
          if (!data || !view.editable) return false;
          const clip = readClip({ html: data.getData('text/html'), text: data.getData('text/plain') });
          if (!clip) return false;
          if (!(view.state.selection instanceof CellSelection) && isOneValue(clip)) return false;
          if (!boxOfSelection(view.state, host.table())) return false;
          event.preventDefault();
          void pasteClip(host, view, clip, values ? PASTE_VALUES : PASTE_ALL);
          return true;
        },
      },
    },
  });
}

export function attachSheetClipboard(host: TableExtraHost): TableExtraHandle {
  const plugin = sheetClipboardPlugin(host);
  host.editor.registerPlugin(plugin, (added, plugins) => [added, ...plugins]);
  return {
    update() {},
    destroy() {
      if (!host.editor.isDestroyed) host.editor.unregisterPlugin(key);
    },
  };
}

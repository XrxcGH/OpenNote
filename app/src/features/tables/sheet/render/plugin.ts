// The ProseMirror plugin that draws `data.sheet` styles (ADR 0056). It turns `drawTable`'s result into node
// decorations on the table, its rows, and its cells, then runs the measuring pass after each layout change. The
// cell text stays the cell's own, so the caret, selection, and screen readers still read the words.

import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { TableMap } from '@tiptap/pm/tables';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { drawTable, styleText } from './draw';
import type { Drawn, DrawInput, DrawnTable } from './draw';
import { measureTable } from './measure';
import type { Scheme } from './color';
import './render.css';

/** What the plugin draws from. The sheet integration supplies it from the block's data. */
export type SheetSource = Omit<DrawInput, 'scheme'>;

export interface SheetRenderOptions {
  /** The table block's sheet and table, or null when the block has no styles to draw. */
  source: () => SheetSource | null;
  scheme: () => Scheme;
}

export const sheetRenderKey = new PluginKey('opennote.sheetRender');

/** The color scheme the person sees. */
export function currentScheme(): Scheme {
  const set = document.documentElement.dataset.theme;
  if (set === 'dark' || set === 'light') return set;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

const attrsOf = (d: Drawn, extra: Record<string, string> = {}): Record<string, string> => {
  const style = styleText(d.vars);
  return { ...extra, ...d.data, ...(style ? { style } : {}) };
};

/** Node decorations for the table in `doc`, from a drawn table. */
export function decorationsFor(doc: PMNode, drawn: DrawnTable): DecorationSet {
  const table = doc.firstChild;
  if (!table || table.childCount !== drawn.rows.length) return DecorationSet.empty;
  const found: Decoration[] = [Decoration.node(0, table.nodeSize, attrsOf(drawn.table))];
  const map = TableMap.get(table);
  table.forEach((row, rowOffset, r) => {
    const rowFrom = 1 + rowOffset;
    found.push(Decoration.node(rowFrom, rowFrom + row.nodeSize, attrsOf(drawn.rows[r])));
    row.forEach((cell, cellOffset) => {
      const from = rowFrom + 1 + cellOffset;
      const rect = map.findCell(from - 1);
      const d = drawn.cells[rect.top]?.[rect.left];
      if (d) found.push(Decoration.node(from, from + cell.nodeSize, attrsOf(d, { 'data-cell': '' })));
    });
  });
  return DecorationSet.create(doc, found);
}

interface Memo {
  doc: PMNode;
  source: SheetSource;
  scheme: Scheme;
  set: DecorationSet;
}

export function sheetRenderPlugin(options: SheetRenderOptions): Plugin {
  let memo: Memo | null = null;
  const decorations = (state: EditorState): DecorationSet => {
    const source = options.source();
    if (!source) return DecorationSet.empty;
    const scheme = options.scheme();
    if (memo && memo.doc === state.doc && memo.source === source && memo.scheme === scheme) return memo.set;
    const set = decorationsFor(state.doc, drawTable({ ...source, scheme }));
    memo = { doc: state.doc, source, scheme, set };
    return set;
  };
  return new Plugin({
    key: sheetRenderKey,
    props: { decorations },
    view(view) {
      let frame = 0;
      const run = () => {
        frame = 0;
        const table = view.dom.querySelector<HTMLElement>('table[data-sheet]');
        if (table) measureTable(table);
      };
      const schedule = () => {
        if (frame === 0) frame = requestAnimationFrame(run);
      };
      const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
      observer?.observe(view.dom);
      schedule();
      return {
        update: schedule,
        destroy() {
          if (frame !== 0) cancelAnimationFrame(frame);
          observer?.disconnect();
        },
      };
    },
  });
}

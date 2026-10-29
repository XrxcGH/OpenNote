// What a smart table's cells show (Phase 7). The cell text stays as typed, so "=B2*C2" is what is stored and what
// the cell holds while you edit it. Everywhere else the cell shows the result, drawn by a decoration: the typed
// text stays in place but hidden, so the caret can still reach it, and the result is drawn over it from the cell's
// data-shown attribute. Rows a filter leaves out are hidden the same way. The decorations are computed a moment
// after typing stops, and ProseMirror maps them through any edit in between.
import type { Node as PMNode } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Locale } from '../engine';
import type { SmartData } from './data';
import { choiceOf, readCell } from './choice';
import type { ChoiceInfo } from './choice';
import { shownFor } from './model';
import type { Grid, SmartModel } from './model';
import styles from './smart.module.css';

/** The transaction meta that carries new decorations. */
export const displayKey = new PluginKey<DecorationSet>('opennote.smartDisplay');

/** The typed text of every cell, row by row. */
export function gridTexts(doc: PMNode): string[][] {
  const table = doc.firstChild;
  const rows: string[][] = [];
  table?.forEach((row) => {
    const cells: string[] = [];
    row.forEach((cell) => cells.push(cell.textContent));
    rows.push(cells);
  });
  return rows;
}

export function gridOf(doc: PMNode, header: boolean, columnIds: readonly string[]): Grid {
  const texts = gridTexts(doc).map((row) => columnIds.map((_, c) => row[c] ?? ''));
  return { header, columnIds, texts };
}

/**
 * Inline decorations that draw each option a choice cell names as a colored chip, and mark text that no option has.
 * The text stays the cell's own, so the caret, selection, and screen readers read the words.
 */
function chipDecorations(cell: PMNode, from: number, info: ChoiceInfo): Decoration[] {
  const paragraph = cell.childCount === 1 ? cell.firstChild : null;
  if (!paragraph || paragraph.childCount > 1 || (paragraph.firstChild && !paragraph.firstChild.isText)) return [];
  const text = paragraph.textContent;
  const base = from + 2;
  const names = readCell(info, text);
  const spans: { start: number; end: number }[] = [];
  if (info.multi) {
    for (const match of text.matchAll(/[^,]+/g)) {
      const word = match[0].trim();
      if (word === '') continue;
      const start = match.index + match[0].indexOf(word);
      spans.push({ start, end: start + word.length });
    }
  } else if (text.trim() !== '') {
    const start = text.length - text.trimStart().length;
    spans.push({ start, end: start + text.trim().length });
  }
  return spans.flatMap((span, index) => {
    const found = names[index];
    if (!found) return [];
    const attrs = found.option
      ? { class: styles.chip, 'data-chip': found.option.color }
      : { class: `${styles.chip} ${styles.chipUnknown}`, 'data-chip': 'unknown' };
    return [Decoration.inline(base + span.start, base + span.end, attrs, { kind: 'chip' })];
  });
}

const KIND_CLASS = { number: styles.number, error: styles.error, text: styles.text } as const;

/** Decorations for the cells that show a result and the rows a filter hides. */
export function buildDecorations(
  doc: PMNode,
  model: SmartModel,
  smart: SmartData,
  locale: Locale,
  typedLabel: (typed: string) => string,
): DecorationSet {
  const table = doc.firstChild;
  if (!table) return DecorationSet.empty;
  const visible = new Set(model.shown);
  const found: Decoration[] = [];
  table.forEach((row, rowOffset, r) => {
    const dataRow = r - model.offset;
    if (dataRow < 0) return;
    const rowFrom = 1 + rowOffset;
    if (!visible.has(dataRow)) {
      found.push(Decoration.node(rowFrom, rowFrom + row.nodeSize, { class: styles.hiddenRow }, { kind: 'hidden' }));
      return;
    }
    row.forEach((cell, cellOffset, c) => {
      const from = rowFrom + 1 + cellOffset;
      const choice = choiceOf(smart, model.columnIds[c]);
      if (choice) found.push(...chipDecorations(cell, from, choice));
      const shown = shownFor(model, smart, dataRow, c, locale);
      if (!shown) return;
      found.push(
        Decoration.node(
          from,
          from + cell.nodeSize,
          {
            class: `${styles.shown} ${KIND_CLASS[shown.kind]}`,
            'data-shown': shown.text,
            title: typedLabel(cell.textContent),
          },
          { kind: 'shown' },
        ),
      );
    });
  });
  return DecorationSet.create(doc, found);
}

/** The position before the cell that holds a text selection, or null. */
function editedCell(state: EditorState): number | null {
  const { selection } = state;
  if (selection instanceof CellSelection) return null;
  const $head = selection.$head;
  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const role = $head.node(depth).type.spec.tableRole as string | undefined;
    if (role === 'cell' || role === 'header_cell') return $head.before(depth);
  }
  return null;
}

interface DisplayState {
  set: DecorationSet;
  /** Whether the table's editor has focus. Without focus no cell is being edited, so every result shows. */
  focused: boolean;
}

export const displayState = new PluginKey<DisplayState>('opennote.smartDisplayState');

/** The decorations of the editor, or empty ones before the plugin is added. */
export const decorationsOf = (state: EditorState): DecorationSet =>
  displayState.getState(state)?.set ?? DecorationSet.empty;

/** The plugin. The cell being edited always shows its typed text. */
export function displayPlugin(): Plugin<DisplayState> {
  return new Plugin<DisplayState>({
    key: displayState,
    state: {
      init: () => ({ set: DecorationSet.empty, focused: false }),
      apply(tr, value) {
        const next = tr.getMeta(displayKey) as DecorationSet | undefined;
        const focus = tr.getMeta(displayState) as boolean | undefined;
        const set = next ?? (tr.docChanged ? value.set.map(tr.mapping, tr.doc) : value.set);
        return { set, focused: focus ?? value.focused };
      },
    },
    // The editor may already have focus when this is added, and no focus event will say so.
    view(view) {
      if (view.hasFocus())
        setTimeout(() => !view.isDestroyed && view.dispatch(view.state.tr.setMeta(displayState, true)));
      return {};
    },
    props: {
      decorations(state) {
        const { set, focused } = displayState.getState(state) ?? { set: DecorationSet.empty, focused: false };
        const at = focused ? editedCell(state) : null;
        if (at === null) return set;
        const mine = set.find(at, at + 1, (spec) => spec.kind === 'shown');
        return mine.length > 0 ? set.remove(mine) : set;
      },
      handleDOMEvents: {
        focus(view) {
          view.dispatch(view.state.tr.setMeta(displayState, true));
          return false;
        },
        blur(view) {
          view.dispatch(view.state.tr.setMeta(displayState, false));
          return false;
        },
      },
    },
  });
}

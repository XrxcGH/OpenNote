// @vitest-environment jsdom
// The cell-range format target and the cell format actions in a real table editor (DESIGN 10.1, ADR 0056). A small
// in-memory block stands in for the page's table block: it keeps the block data, applies merge patches as the page
// does, and counts them, so "one patch" means one data patch (one undo step).
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { CellSelection } from '@tiptap/pm/tables';
import { afterEach, describe, expect, it } from 'vitest';
import { runEditorCommand } from '../../../editor/commands/catalog';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../editor/host';
import type { EditorHost } from '../../../editor/host';
import { createMarkdownCache } from '../../../editor/markdown';
import type { TableData } from '../../../editor/schema/specs';
import { tableDataToDoc } from '../../../editor/table/mapping';
import { applyMergePatch } from '../../../platform/mergePatch';
import { setBorders, setFill, setFormat } from '../ui/toolbar/actions';
import { createCellRangeTarget, boxOfSelection } from './formatTarget';
import type { CellHost } from './formatTarget';
import { readSheet, resolve, sheetPatch } from './model';
import type { CellStyle } from './model';
import { registerFormatTarget } from '../../../editor/commands/formatTarget';
import type { TableExtraHost } from '../../page';

const editorHost: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

const LETTERS = 'ABCD';

/** A 4 by 4 table whose cells read A1 to D4. */
function sample(): TableData {
  return {
    header: false,
    columns: [0, 1, 2, 3].map((c) => ({ id: `col${c}`, width: 100 })),
    rows: [0, 1, 2, 3].map((r) => ({
      id: `row${r}`,
      cells: Object.fromEntries([0, 1, 2, 3].map((c) => [`col${c}`, { markdown: `${LETTERS[c]}${r + 1}` }])),
    })),
  };
}

interface Rig {
  editor: Editor;
  host: TableExtraHost;
  patches: Record<string, unknown>[];
  block(): Record<string, unknown>;
  style(cell: string): CellStyle;
  select(from: string, to?: string): void;
}

let rigs: Rig[] = [];
let stops: (() => void)[] = [];
afterEach(() => {
  rigs.forEach((rig) => {
    rig.editor.view.dom.remove();
    rig.editor.destroy();
  });
  stops.forEach((stop) => stop());
  rigs = [];
  stops = [];
});

const at = (name: string): [number, number] => [Number(name.slice(1)) - 1, LETTERS.indexOf(name[0])];

function rig(markdown: Record<string, string> = {}): Rig {
  let block: Record<string, unknown> = { ...sample() };
  for (const [cell, text] of Object.entries(markdown)) {
    const [row, col] = at(cell);
    const data = block as unknown as TableData;
    data.rows[row].cells[`col${col}`] = { markdown: text };
  }
  const patches: Record<string, unknown>[] = [];
  const root = document.createElement('div');
  document.body.append(root);
  const editor = createBlockEditor(root, tableDataToDoc(block as unknown as TableData), {
    kind: 'table',
    block: 'b1',
    host: editorHost,
  });
  const table = () => block as unknown as TableData;
  const host: CellHost = {
    editor,
    cache: createMarkdownCache(),
    data: () => block,
    table,
    apply: (change, extra) => {
      const next = change(table());
      if (!next) return Promise.resolve(false);
      block = { ...block, ...next };
      if (extra) {
        patches.push(extra);
        block = applyMergePatch(block, extra);
      }
      return Promise.resolve(true);
    },
    patch: (data) => {
      patches.push(data);
      block = applyMergePatch(block, data);
      return Promise.resolve(undefined);
    },
    announce: () => {},
  };
  const full = host as unknown as TableExtraHost;
  stops.push(
    registerFormatTarget(createCellRangeTarget((state) => (state.doc === editor.state.doc ? host : undefined))),
  );
  const made: Rig = {
    editor,
    host: full,
    patches,
    block: () => block,
    style(cell) {
      const [row, col] = at(cell);
      return resolve(readSheet(block), table(), `row${row}`, `col${col}`).style;
    },
    select(from, to = from) {
      const cellPos = (name: string) => {
        const [row, col] = at(name);
        let found = -1;
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === 'tableRow' && node.attrs.rowId === `row${row}`) {
            node.forEach((cell, offset) => {
              if (cell.attrs.colId === `col${col}`) found = pos + 1 + offset;
            });
          }
          return found === -1;
        });
        return found;
      };
      const state = editor.state;
      editor.view.dispatch(state.tr.setSelection(CellSelection.create(state.doc, cellPos(from), cellPos(to))));
    },
  };
  rigs.push(made);
  return made;
}

describe('the cell range format target', () => {
  it('writes one patch that gives B2:C3 one style, and the inverse patch takes it back', async () => {
    const r = rig();
    r.select('B2', 'C3');
    const before = readSheet(r.block());
    await setFill(r.host, 'theme:accent5');
    expect(r.patches).toHaveLength(1);
    const sheet = readSheet(r.block());
    const cells = sheet.cells as Record<string, Record<string, string>>;
    const ids = ['B2', 'C2', 'B3', 'C3'].map((name) => {
      const [row, col] = at(name);
      return cells[`row${row}`][`col${col}`];
    });
    expect(new Set(ids).size).toBe(1);
    expect(Object.keys(sheet.styles as object)).toHaveLength(1);
    expect(r.style('A1').fill).toBeUndefined();
    expect(r.style('B2').fill).toBe('theme:accent5');
    // Undo sends the inverse merge patch, which removes the cells and the style.
    const undo = sheetPatch(sheet, before);
    expect(readSheet(applyMergePatch(r.block(), undo))).toEqual(before);
  });
});

describe('cell formats on whole cells', () => {
  it('sets font.bold on a selected cell and takes the bold marks off its runs', async () => {
    const r = rig({ B2: '**bold** and plain' });
    r.select('B2');
    expect(runEditorCommand(r.editor, 'format.bold')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.style('B2').font?.bold).toBe(true);
    const row = (r.block() as unknown as TableData).rows[1];
    expect(row.cells.col1.markdown).toBe('bold and plain');
    expect(r.patches).toHaveLength(1);
  });

  it('toggles the bold mark only when text in a cell is selected', async () => {
    const r = rig({ B2: 'text' });
    const state = r.editor.state;
    let start = -1;
    state.doc.descendants((node, pos) => {
      if (node.isText && node.text === 'text') start = pos;
    });
    r.editor.view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, start, start + 4)));
    runEditorCommand(r.editor, 'format.bold');
    await Promise.resolve();
    expect(r.patches).toHaveLength(0);
    expect(r.style('B2').font?.bold).toBeUndefined();
    let marked = false;
    r.editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'bold')) marked = true;
    });
    expect(marked).toBe(true);
  });
});

describe('the cell range target', () => {
  it('claims whole cells only, and reports the box of a caret or a range', () => {
    const r = rig();
    r.select('B2', 'C3');
    expect(boxOfSelection(r.editor.state, r.block() as unknown as TableData)).toEqual({
      top: 1,
      left: 1,
      bottom: 2,
      right: 2,
    });
  });
});

describe('borders and number formats', () => {
  it('runs Outside borders on B2:C3: sides of the edge cells only, nothing inside', async () => {
    const r = rig();
    r.select('B2', 'C3');
    await setBorders(r.host, 'outside');
    const side = (cell: string) => Object.keys(r.style(cell).border ?? {}).sort();
    expect(side('B2')).toEqual(['l', 't']);
    expect(side('C2')).toEqual(['r', 't']);
    expect(side('B3')).toEqual(['b', 'l']);
    expect(side('C3')).toEqual(['b', 'r']);
    for (const cell of ['A1', 'A2', 'D3', 'B4', 'C1']) expect(side(cell)).toEqual([]);
    expect(r.patches).toHaveLength(1);
    expect(r.style('B2').border?.t).toEqual({ style: 'thin' });
  });

  it('clears the borders of the box with No border', async () => {
    const r = rig();
    r.select('B2', 'C3');
    await setBorders(r.host, 'all');
    expect(Object.keys(r.style('B2').border ?? {}).sort()).toEqual(['b', 'l', 'r', 't']);
    await setBorders(r.host, 'none');
    expect(r.style('B2').border).toBeUndefined();
  });

  it('writes a number format and General takes it away', async () => {
    const r = rig();
    r.select('B2');
    await setFormat(r.host, '0.00%');
    expect(r.style('B2').fmt).toBe('0.00%');
    await setFormat(r.host, null);
    expect(r.style('B2').fmt).toBeUndefined();
  });

  it('sets a text size one point up and a cell alignment through the shared commands', async () => {
    const r = rig();
    r.select('A1');
    runEditorCommand(r.editor, 'format.fontSizeUp');
    await Promise.resolve();
    await Promise.resolve();
    expect(r.style('A1').font?.size).toBe(13);
    runEditorCommand(r.editor, 'para.alignCenter');
    await Promise.resolve();
    await Promise.resolve();
    expect(r.style('A1').align?.h).toBe('center');
  });
});

describe('requests on whole cells that the cell style does not cover', () => {
  it('keeps the other marks when Superscript goes on a whole cell', async () => {
    const r = rig({ B2: '**bold** and *it*' });
    r.select('B2');
    expect(runEditorCommand(r.editor, 'format.superscript')).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.style('B2').font?.script).toBe('super');
    expect((r.block() as unknown as TableData).rows[1].cells.col1.markdown).toBe('**bold** and *it*');
  });

  it('sets the font family of whole cells from the Home tab command', async () => {
    const r = rig();
    r.select('B2', 'C2');
    expect(runEditorCommand(r.editor, 'format.font', { value: 'Georgia' })).toBe(true);
    await Promise.resolve();
    await Promise.resolve();
    expect(r.style('B2').font?.family).toBe('Georgia');
    expect(r.style('C2').font?.family).toBe('Georgia');
  });

  it('lets the text take Highlight on whole cells, which the cell style has no field for', () => {
    const r = rig({ B2: 'text' });
    r.select('B2');
    expect(runEditorCommand(r.editor, 'format.highlight')).toBe(true);
    expect(r.patches).toHaveLength(0);
  });
});


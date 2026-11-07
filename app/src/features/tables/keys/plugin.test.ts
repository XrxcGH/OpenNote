// @vitest-environment jsdom
// Grid mode and Edit mode in a real table editor (ADR 0063). Keys go to the editor as key presses, so the plugin,
// the table's own keys, and the registered sheet commands all take part.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { Decoration } from '@tiptap/pm/view';
import axe from 'axe-core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../app/flags';
import { linkApplies } from '../../../editor/commands/state';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../editor/host';
import type { EditorHost } from '../../../editor/host';
import { tableSchema } from '../../../editor/schema/schema';
import { parseDate, todayDays } from '../engine/dates';
import { registerSheetKeyCommands } from './commands';
import { activeCell, gridOf, insideOneCell, modeOf, sheetKeysPlugin, textsOf } from './plugin';
import type { SheetKeysOptions } from './plugin';
import { address } from './grid';
import { sheetKeysKey } from './state';

const host: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

const { nodes } = tableSchema;

function tableDoc(rows: string[][], header: boolean): PMNode {
  const made = rows.map((line, r) =>
    nodes.tableRow.create(
      null,
      line.map((text) =>
        (header && r === 0 ? nodes.tableHeader : nodes.tableCell).create(
          null,
          nodes.paragraph.create(null, text ? tableSchema.text(text) : null),
        ),
      ),
    ),
  );
  return nodes.doc.create(null, nodes.table.create(null, made));
}

let editors: Editor[] = [];
let stopCommands = () => {};
beforeAll(() => {
  initFlags('dev');
  stopCommands = registerSheetKeyCommands();
});
afterAll(() => stopCommands());
afterEach(() => {
  editors.forEach((editor) => {
    editor.view.dom.remove();
    editor.destroy();
  });
  editors = [];
});

interface Harness {
  editor: Editor;
  said: string[];
  press(key: string, mods?: string): void;
  type(text: string): void;
  select(from: string, to?: string): void;
  caretIn(cell: string): void;
  texts(): string[][];
  at(): string | null;
  range(): string | null;
}

/** "B2" as a cell of a table without a header row, or with one. */
function cellOf(name: string, header: boolean) {
  const column = name.charCodeAt(0) - 65;
  const number = Number(name.slice(1));
  return { row: header ? number : number - 1, column };
}

function mount(rows: string[][], options: Partial<SheetKeysOptions> & { header?: boolean } = {}): Harness {
  const header = options.header ?? false;
  const root = document.body.appendChild(document.createElement('div'));
  const editor = createBlockEditor(root, tableDoc(rows, header), { kind: 'table', block: 'b1', host });
  editors.push(editor);
  const said: string[] = [];
  const plugin = sheetKeysPlugin({ spreadsheet: true, announce: (text) => said.push(text), ...options });
  editor.registerPlugin(plugin, (added, plugins) => [added, ...plugins]);
  const { view } = editor;
  const cellPos = (name: string) => {
    const at = cellOf(name, header);
    let pos = 1;
    const table = view.state.doc.firstChild!;
    for (let r = 0; r < at.row; r++) pos += table.child(r).nodeSize;
    pos += 1;
    for (let c = 0; c < at.column; c++) pos += table.child(at.row).child(c).nodeSize;
    return pos;
  };
  const press = (key: string, mods = '') => {
    const has = (name: string) => mods.includes(name);
    const code = key.length === 1 ? (/\d/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`) : key;
    const event = new KeyboardEvent('keydown', {
      key,
      code: key === ';' ? 'Semicolon' : code,
      ctrlKey: has('ctrl'),
      shiftKey: has('shift'),
      altKey: has('alt'),
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(event);
  };
  return {
    editor,
    said,
    press,
    type: (text) => [...text].forEach((key) => press(key)),
    select(from, to = from) {
      view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, cellPos(from), cellPos(to))));
    },
    caretIn(name) {
      editor.commands.setTextSelection(cellPos(name) + 2);
    },
    texts: () => textsOf(view.state.doc),
    at: () => {
      const at = activeCell(view.state);
      return at && address(at, header);
    },
    range: () => {
      const grid = gridOf(view.state);
      if (!grid) return null;
      const { box } = grid;
      return `${address({ row: box.top, column: box.left }, header)}:${address({ row: box.bottom, column: box.right }, header)}`;
    },
  };
}

const FIVE = [
  ['1', '2', '3', '', ''],
  ['4', '5', '6', '', ''],
  ['7', '8', '9', '', ''],
  ['', '', '', '', ''],
  ['', '', '', '', ''],
];

describe('Grid mode moves', () => {
  it('jumps to the data edges and selects to the last used cell', () => {
    const sheet = mount(FIVE);
    sheet.select('A1');
    sheet.press('ArrowDown', 'ctrl');
    expect(sheet.at()).toBe('A3');
    sheet.select('A1');
    sheet.press('ArrowRight', 'ctrl');
    expect(sheet.at()).toBe('C1');
    sheet.select('A1');
    sheet.press('End', 'ctrl shift');
    expect(sheet.range()).toBe('A1:C3');
    expect(sheet.at()).toBe('A1');
  });

  it('moves with arrows, extends with Shift, and collapses with Esc', () => {
    const sheet = mount(FIVE);
    sheet.select('B2');
    sheet.press('ArrowRight');
    expect(sheet.at()).toBe('C2');
    sheet.press('ArrowDown', 'shift');
    sheet.press('ArrowLeft', 'shift');
    expect(sheet.range()).toBe('B2:C3');
    sheet.press('Escape');
    expect(sheet.range()).toBe('C2:C2');
    sheet.press('Home');
    expect(sheet.at()).toBe('A2');
    sheet.press(' ', 'shift');
    expect(sheet.range()).toBe('A2:E2');
  });

  it('selects the column, the region, then the table', () => {
    const sheet = mount(FIVE);
    sheet.select('B2');
    sheet.press(' ', 'ctrl');
    expect(sheet.range()).toBe('B1:B5');
    sheet.select('B2');
    sheet.press('a', 'ctrl');
    expect(sheet.range()).toBe('A1:C3');
    sheet.press('a', 'ctrl');
    expect(sheet.range()).toBe('A1:E5');
  });
});

describe('entries', () => {
  it('types over a cell, cancels with Esc, edits with F2, and commits with Enter', () => {
    const sheet = mount(FIVE);
    sheet.select('B2');
    sheet.type('7');
    expect(sheet.texts()[1][1]).toBe('7');
    expect(modeOf(sheet.editor.state)).toBe('edit');
    sheet.press('Escape');
    expect(sheet.texts()[1][1]).toBe('5');
    expect(modeOf(sheet.editor.state)).toBe('grid');
    expect(sheet.at()).toBe('B2');
    sheet.press('F2');
    const { selection } = sheet.editor.state;
    expect(modeOf(sheet.editor.state)).toBe('edit');
    expect(selection.empty && selection.$head.parentOffset === selection.$head.parent.content.size).toBe(true);
    // In Edit mode the browser types the text; jsdom has no text input, so the test inserts it.
    sheet.editor.view.dispatch(sheet.editor.state.tr.insertText('9'));
    sheet.press('Enter');
    expect(sheet.texts()[1][1]).toBe('59');
    expect(modeOf(sheet.editor.state)).toBe('grid');
    expect(sheet.at()).toBe('B3');
  });

  it('goes through a range with Enter: B2, B3, C2, C3', () => {
    const sheet = mount(FIVE);
    sheet.select('B2', 'C3');
    const seen = [sheet.at()];
    for (let i = 0; i < 4; i++) {
      sheet.press('Enter');
      seen.push(sheet.at());
    }
    expect(seen).toEqual(['B2', 'B3', 'C2', 'C3', 'B2']);
    expect(sheet.range()).toBe('B2:C3');
  });

  it('finishes an Enter mode entry with an arrow, and keeps the caret in the cell in Edit mode', () => {
    const sheet = mount(FIVE);
    sheet.select('A1');
    sheet.type('x');
    sheet.press('ArrowRight');
    expect(sheet.texts()[0][0]).toBe('x');
    expect(sheet.at()).toBe('B1');
    sheet.caretIn('C1');
    sheet.press('ArrowLeft');
    expect(modeOf(sheet.editor.state)).toBe('edit');
    expect(sheet.at()).toBe('C1');
    sheet.press('Tab');
    expect(sheet.at()).toBe('D1');
    expect(modeOf(sheet.editor.state)).toBe('grid');
  });

  it('clears the range with Delete and the active cell with Backspace', () => {
    const sheet = mount(FIVE);
    sheet.select('A1', 'B2');
    sheet.press('Delete');
    expect(sheet.texts().slice(0, 2)).toEqual([
      ['', '', '3', '', ''],
      ['', '', '6', '', ''],
    ]);
    sheet.select('C3');
    sheet.press('Backspace');
    expect(sheet.texts()[2][2]).toBe('');
    expect(modeOf(sheet.editor.state)).toBe('edit');
  });

  it('adds a row with Tab in the last cell', () => {
    const sheet = mount([['a', 'b']]);
    sheet.select('B1');
    sheet.press('Tab');
    expect(sheet.texts()).toEqual([
      ['a', 'b'],
      ['', ''],
    ]);
    expect(sheet.at()).toBe('A2');
  });
});

describe('line breaks', () => {
  const breaks = (editor: Editor) => {
    let count = 0;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'hardBreak') count++;
    });
    return count;
  };

  it('adds a line break with Alt+Enter in Edit mode', () => {
    const sheet = mount(FIVE);
    sheet.caretIn('A1');
    sheet.press('Enter', 'alt');
    expect(breaks(sheet.editor)).toBe(1);
    expect(sheet.at()).toBe('A1');
  });

  it('keeps today’s Enter in a table set to document keys', () => {
    const sheet = mount(FIVE, { spreadsheet: false });
    sheet.caretIn('A1');
    sheet.press('Enter');
    expect(breaks(sheet.editor)).toBe(1);
    expect(sheet.editor.state.selection instanceof CellSelection).toBe(false);
    sheet.press('ArrowDown', 'ctrl');
    expect(modeOf(sheet.editor.state)).toBeNull();
  });
});

describe('fills and stamps', () => {
  it('fills B2 down into B3:B4 and moves its references', () => {
    const sheet = mount([
      ['1', '', ''],
      ['2', '=A2', ''],
      ['3', '', ''],
      ['4', 'old', ''],
    ]);
    sheet.select('B2', 'B4');
    sheet.press('d', 'ctrl');
    expect(sheet.texts().map((row) => row[1])).toEqual(['', '=A2', '=A3', '=A4']);
    sheet.select('B2', 'C2');
    sheet.press('r', 'ctrl');
    expect(sheet.texts()[1][2]).toBe('=B2');
  });

  it('enters today’s date as a date the engine reads', () => {
    const now = new Date(2026, 10, 7, 13, 5);
    const sheet = mount(FIVE, { now: () => now });
    sheet.select('D4');
    sheet.press(';', 'ctrl');
    sheet.press('Enter');
    const text = sheet.texts()[3][3];
    expect(text).toBe('11/7/2026');
    expect(parseDate(text, 'mdy')).toBe(todayDays(now));
  });

  it('copies the formula and the value from the cell above', () => {
    const sheet = mount(
      [
        ['=1+1', ''],
        ['', ''],
      ],
      { shown: (_view, at) => (at.row === 0 && at.column === 0 ? '2' : null) },
    );
    sheet.select('A2');
    sheet.press("'", 'ctrl');
    sheet.press('Enter');
    expect(sheet.texts()[1][0]).toBe('=1+1');
  });
});

describe('screen readers', () => {
  it('announces the address, header, value, and formula of the new active cell', () => {
    const sheet = mount(
      [
        ['Item', 'Qty', 'Total'],
        ['a', '1', '=B1*2'],
        ['b', '2', '=B2*2'],
        ['c', '3', '=B3*2'],
        ['d', '5', '=B4*2'],
      ],
      { header: true, shown: (_view, at) => (at.column === 2 && at.row > 0 ? '10' : null) },
    );
    sheet.select('C3');
    sheet.press('ArrowDown');
    expect(sheet.said.at(-1)).toBe('C4, Total, 10, formula equals B4 times 2');
  });

  it('numbers every cell and marks the range and the active cell', () => {
    const sheet = mount(FIVE);
    sheet.select('B2', 'C3');
    const dom = sheet.editor.view.dom;
    const b2 = dom.querySelectorAll('tr')[1].querySelectorAll('td')[1];
    expect(b2.getAttribute('aria-rowindex')).toBe('2');
    expect(b2.getAttribute('aria-colindex')).toBe('2');
    expect(dom.querySelectorAll('[aria-selected="true"]')).toHaveLength(4);
    expect(b2.className).toMatch(/active/);
    expect(dom.getAttribute('data-scope')).toBe('editor editor.table tableGrid');
    sheet.caretIn('A1');
    expect(dom.getAttribute('data-scope')).toBe('editor editor.table tableEdit');
  });
});

describe('the grid that screen readers read', () => {
  it('makes a table with spreadsheet keys a grid, so aria-selected is allowed on its cells', async () => {
    const sheet = mount(
      [
        ['Item', 'Qty'],
        ['a', '1'],
        ['b', '2'],
      ],
      { header: true },
    );
    const dom = sheet.editor.view.dom;
    expect(dom.querySelector('table')?.getAttribute('role')).toBe('grid');
    expect(dom.querySelector('th')?.getAttribute('role')).toBe('columnheader');
    expect(dom.querySelector('td')?.getAttribute('role')).toBe('gridcell');
    sheet.select('A1', 'B2');
    expect(dom.querySelectorAll('td[aria-selected="true"]')).toHaveLength(4);
    const rules = ['aria-allowed-attr', 'aria-required-children', 'aria-required-parent', 'aria-allowed-role'];
    const results = await axe.run(dom, { runOnly: { type: 'rule', values: rules } });
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
    sheet.editor.view.dispatch(sheet.editor.state.tr.setMeta(sheetKeysKey, { spreadsheet: false }));
    expect(dom.querySelector('table')?.getAttribute('role')).toBeNull();
    expect(dom.querySelector('td')?.getAttribute('role')).toBeNull();
    expect(dom.querySelector('td')?.getAttribute('aria-rowindex')).toBe('2');
  });

  it('marks no cell selected while focus is outside the editor, as when the table is selected as an object', () => {
    const sheet = mount(FIVE);
    sheet.select('B2', 'C3');
    const dom = sheet.editor.view.dom;
    expect(dom.querySelectorAll('[aria-selected="true"]')).toHaveLength(4);
    dom.dispatchEvent(new FocusEvent('blur'));
    expect(dom.querySelectorAll('[aria-selected]')).toHaveLength(0);
    dom.dispatchEvent(new FocusEvent('focus'));
    expect(dom.querySelectorAll('[aria-selected="true"]')).toHaveLength(4);
  });

  it('maps the cell numbers through typing instead of rebuilding them for every cell', () => {
    const rows = Array.from({ length: 30 }, () => Array.from({ length: 10 }, () => 'x'));
    const sheet = mount(rows);
    sheet.caretIn('B2');
    // The first change gives the rows their IDs, which moves no cell but changes the rows; later ones don't.
    sheet.editor.commands.insertContent('-');
    const node = vi.spyOn(Decoration, 'node');
    sheet.editor.commands.insertContent('typed');
    // Only the active cell's outline is drawn again; the 300 cells' numbers are mapped.
    expect(node.mock.calls.length).toBeLessThan(10);
    node.mockRestore();
    const b2 = sheet.editor.view.dom.querySelectorAll('tr')[1].querySelectorAll('td')[1];
    expect(b2.textContent).toBe('-typedx');
    expect(b2.getAttribute('aria-colindex')).toBe('2');
  });

  it('numbers the cells again when a row is added', () => {
    const sheet = mount([
      ['1', '2'],
      ['3', '4'],
    ]);
    sheet.caretIn('A1');
    sheet.editor.commands.addRowBefore();
    const rows = sheet.editor.view.dom.querySelectorAll('tr');
    expect(rows).toHaveLength(3);
    expect(rows[2].querySelectorAll('td')[1].getAttribute('aria-rowindex')).toBe('3');
    expect(rows[0].querySelectorAll('td')[1].getAttribute('aria-colindex')).toBe('2');
    expect(rows[0].querySelectorAll('td')[1].getAttribute('role')).toBe('gridcell');
  });

  it('tells a change inside one cell from one that moves cells', () => {
    const sheet = mount([
      ['1', '2'],
      ['3', '4'],
    ]);
    const { state } = sheet.editor;
    expect(insideOneCell(state.tr.insertText('a', 4))).toBe(true);
    expect(insideOneCell(state.tr.delete(4, 5))).toBe(true);
    // From A1's text to B1's text crosses a cell's edge.
    expect(insideOneCell(state.tr.delete(4, 10))).toBe(false);
    expect(insideOneCell(state.tr.delete(1, 1 + state.doc.firstChild!.firstChild!.nodeSize))).toBe(false);
  });

  it('leaves Ctrl+K to the palette when cells are selected', () => {
    const sheet = mount(FIVE);
    sheet.select('A1', 'B2');
    expect(linkApplies(sheet.editor.state)).toBe(false);
  });
});

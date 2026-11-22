// @vitest-environment jsdom
// Spreadsheet keys treat a merged cell as one cell (ADR 0064): an arrow into a merge lands on its top-left slot, and the
// next arrow leaves its far edge. Keys go to the editor as key presses.
import type { Editor } from '@tiptap/core';
import { CellSelection } from '@tiptap/pm/tables';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { initFlags } from '../../../../app/flags';
import { createBlockEditor } from '../../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../../editor/host';
import type { EditorHost } from '../../../../editor/host';
import { tableDataToDoc } from '../../../../editor/table/mapping';
import { spansOf } from '../../../../editor/table/spans';
import type { TableData } from '../../../../editor/schema/specs';
import { registerSheetKeyCommands } from '../../keys/commands';
import { address } from '../../keys/grid';
import { activeCell, sheetKeysPlugin } from '../../keys/plugin';
import { cellsOf } from '../../keys/state';

const host: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

/** Four rows by four columns, with B2:C3 merged. */
function mount() {
  const columns = Array.from({ length: 4 }, (_, c) => ({ id: `c${c + 1}`, width: 100 }));
  const data: TableData = {
    header: false,
    columns,
    rows: Array.from({ length: 4 }, (_, r) => ({
      id: `r${r + 1}`,
      cells: Object.fromEntries(columns.map((col) => [col.id, { markdown: '' }])),
    })),
  };
  const sheet = { merges: { m1: { from: ['r2', 'c2'], to: ['r3', 'c3'] } } };
  const root = document.body.appendChild(document.createElement('div'));
  const doc = tableDataToDoc(data, undefined, spansOf(data, sheet));
  const editor = createBlockEditor(root, doc, { kind: 'table', block: 'b1', host });
  editor.registerPlugin(sheetKeysPlugin({ spreadsheet: true, announce: () => {} }), (added, plugins) => [
    added,
    ...plugins,
  ]);
  editor.view.dom.dispatchEvent(new FocusEvent('focus'));
  return editor;
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

function drive() {
  const editor = mount();
  editors.push(editor);
  const { view } = editor;
  return {
    select(row: number, column: number) {
      const pos = cellsOf(view.state.doc)[row][column].pos;
      view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, pos)));
    },
    press(key: string) {
      view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
    },
    at: () => {
      const at = activeCell(view.state);
      return at && address(at, false);
    },
  };
}

describe('keys over merged cells', () => {
  it('Arrow Right from A2 into merged B2:C3 lands on B2, and the next Right lands on D2', () => {
    const keys = drive();
    keys.select(1, 0);
    expect(keys.at()).toBe('A2');
    keys.press('ArrowRight');
    expect(keys.at()).toBe('B2');
    keys.press('ArrowRight');
    expect(keys.at()).toBe('D2');
  });

  it('Arrow Left from D2 enters the merge on B2, Arrow Down from B2 leaves it for B4, and Arrow Up returns to B2', () => {
    const keys = drive();
    keys.select(1, 3);
    keys.press('ArrowLeft');
    expect(keys.at()).toBe('B2');
    keys.press('ArrowDown');
    expect(keys.at()).toBe('B4');
    keys.press('ArrowUp');
    expect(keys.at()).toBe('B2');
  });

  it('Tab goes from B2 to D2 and back, not to a slot of the same cell', () => {
    const keys = drive();
    keys.select(1, 1);
    keys.press('Tab');
    expect(keys.at()).toBe('D2');
    keys.press('Tab');
    expect(keys.at()).toBe('A3');
  });
});

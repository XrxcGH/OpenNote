// @vitest-environment jsdom
// The pointer lane in a real table editor (DESIGN.md section 12): the fill handle's drop, the touch handles, the long
// press, and a pen stroke in Draw border mode. A test document has no layout, so the cells' rectangles are stubbed:
// columns A to E are 100 wide and rows are 30 high, at the top left of the page.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { CellSelection } from '@tiptap/pm/tables';
import { TextSelection } from '@tiptap/pm/state';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../app/flags';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../editor/host';
import type { EditorHost } from '../../../editor/host';
import { tableSchema } from '../../../editor/schema/schema';
import type { TableData } from '../../../editor/schema/specs';
import type { TableExtraHost } from '../../page';
import { registerSheetKeyCommands } from '../keys/commands';
import { gridOf, sheetKeysPlugin, textsOf } from '../keys/plugin';
import { resolve, readSheet } from '../sheet/model';
import { fill, selectRange } from './actions';
import { attachPointerLayer } from './layer';
import type { PointerLayer } from './layer';
import { activePointer } from './active';
import { borderMode, setBorderMode } from './mode';

const editorHost: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

const { nodes } = tableSchema;
const ROW_IDS = ['r0', 'r1', 'r2', 'r3', 'r4', 'r5'];
const COL_IDS = ['c0', 'c1', 'c2', 'c3', 'c4'];

function tableDoc(rows: string[][]): PMNode {
  const made = rows.map((line) =>
    nodes.tableRow.create(
      null,
      line.map((text) =>
        nodes.tableCell.create(null, nodes.paragraph.create(null, text ? tableSchema.text(text) : null)),
      ),
    ),
  );
  return nodes.doc.create(null, nodes.table.create(null, made));
}

const GRID = [
  ['1', 'Mon', '', '', ''],
  ['3', '=A1*2', '', '', ''],
  ['', '', '', '', ''],
  ['', '', '', '', ''],
  ['', '', '', '', ''],
];

let editors: Editor[] = [];
let layers: PointerLayer[] = [];
let stopCommands = () => {};
const restore: (() => void)[] = [];

beforeAll(() => {
  initFlags('dev');
  stopCommands = registerSheetKeyCommands();
});
afterAll(() => stopCommands());
beforeEach(() => {
  // Layout: a cell's rectangle comes from its place in the table.
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const rect = (left: number, top: number, width: number, height: number) =>
      ({
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON() {},
      }) as DOMRect;
    if (this instanceof HTMLTableRowElement) return rect(0, this.rowIndex * 30, 500, 30);
    if (this instanceof HTMLTableCellElement)
      return rect(this.cellIndex * 100, (this.parentElement as HTMLTableRowElement).rowIndex * 30, 100, 30);
    return rect(0, 0, 500, 150);
  };
  restore.push(() => (HTMLElement.prototype.getBoundingClientRect = original));
});
afterEach(() => {
  setBorderMode('off');
  layers.forEach((layer) => layer.destroy());
  layers = [];
  editors.forEach((editor) => {
    editor.view.dom.parentElement?.remove();
    editor.destroy();
  });
  editors = [];
  restore.splice(0).forEach((undo) => undo());
  vi.useRealTimers();
});

interface Mounted {
  editor: Editor;
  said: string[];
  patches: Record<string, unknown>[];
  select(from: string, to?: string): void;
  texts(): string[][];
  range(): string | null;
}

const cellOf = (name: string) => ({ row: Number(name.slice(1)) - 1, column: name.charCodeAt(0) - 65 });

function mount(rows: string[][], data: Record<string, unknown> = {}, withLayer = false): Mounted {
  const scroller = document.body.appendChild(document.createElement('div'));
  const root = scroller.appendChild(document.createElement('div'));
  const editor = createBlockEditor(root, tableDoc(rows), { kind: 'table', block: 'b1', host: editorHost });
  editors.push(editor);
  const said: string[] = [];
  const patches: Record<string, unknown>[] = [];
  editor.registerPlugin(
    sheetKeysPlugin({ spreadsheet: true, announce: (text) => said.push(text) }),
    (added, plugins) => [added, ...plugins],
  );
  editor.view.dom.dispatchEvent(new FocusEvent('focus'));
  const table = {
    header: false,
    columns: COL_IDS.slice(0, rows[0].length).map((id) => ({ id, width: 100 })),
    rows: ROW_IDS.slice(0, rows.length).map((id) => ({ id, cells: {} })),
  } as unknown as TableData;
  const host = {
    editor,
    block: 'b1',
    data: () => data,
    table: () => table,
    apply: async () => true,
    patch: async (patch: Record<string, unknown>) => {
      patches.push(patch);
      return true;
    },
    announce: (text: string) => said.push(text),
  } as unknown as TableExtraHost;
  hosts.set(editor, host);
  if (withLayer) layers.push(attachPointerLayer(editor.view, host));
  const { view } = editor;
  const pos = (name: string) => {
    const at = cellOf(name);
    let p = 1;
    const t = view.state.doc.firstChild!;
    for (let r = 0; r < at.row; r++) p += t.child(r).nodeSize;
    p += 1;
    for (let c = 0; c < at.column; c++) p += t.child(at.row).child(c).nodeSize;
    return p;
  };
  return {
    editor,
    said,
    patches,
    select: (from, to = from) =>
      view.dispatch(view.state.tr.setSelection(CellSelection.create(view.state.doc, pos(from), pos(to)))),
    texts: () => textsOf(view.state.doc),
    range: () => {
      const g = gridOf(view.state);
      return (
        g &&
        `${String.fromCharCode(65 + g.box.left)}${g.box.top + 1}:${String.fromCharCode(65 + g.box.right)}${g.box.bottom + 1}`
      );
    },
  };
}
const hosts = new WeakMap<Editor, TableExtraHost>();

/** A pointer event; jsdom has no PointerEvent, so a mouse event carries the extra fields. */
function pointer(type: string, target: Element, x: number, y: number, pointerType: string, extra: MouseEventInit = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, ...extra });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: 1 } });
  target.dispatchEvent(event);
}

describe('fill handle', () => {
  it('fills =A2*2 from B2 down three rows as =A3*2, =A4*2, =A5*2', async () => {
    const sheet = mount([
      ['1', '', '', '', ''],
      ['2', '=A2*2', '', '', ''],
      ['3', '', '', '', ''],
      ['4', '', '', '', ''],
      ['5', '', '', '', ''],
    ]);
    sheet.select('B2');
    const source = { top: 1, left: 1, bottom: 1, right: 1 };
    await fill(
      sheet.editor.view,
      hosts.get(sheet.editor)!,
      { source, box: { ...source, bottom: 4 }, direction: 'down' },
      'series',
    );
    expect(sheet.texts().map((row) => row[1])).toEqual(['', '=A2*2', '=A3*2', '=A4*2', '=A5*2']);
    expect(sheet.range()).toBe('B2:B5');
  });

  it('continues a series, and the menu choice Copy cells writes copies over it', async () => {
    const sheet = mount(GRID);
    sheet.select('A1', 'A2');
    const source = { top: 0, left: 0, bottom: 1, right: 0 };
    const view = sheet.editor.view;
    const host = hosts.get(sheet.editor)!;
    const drop = await fill(view, host, { source, box: { ...source, bottom: 3 }, direction: 'down' }, 'series');
    expect(sheet.texts().map((row) => row[0])).toEqual(['1', '3', '5', '7', '']);
    await fill(view, host, drop, 'copy', undefined, drop);
    expect(sheet.texts().map((row) => row[0])).toEqual(['1', '3', '1', '3', '']);
    // Formats-only puts the cells' own content back.
    await fill(view, host, drop, 'formats', undefined, drop);
    expect(sheet.texts().map((row) => row[0])).toEqual(['1', '3', '', '', '']);
  });

  it('copies the format of the source cell with the fill, and not with Fill without formatting', async () => {
    const data = { sheet: { styles: { S1: { font: { bold: true } } }, cells: { r0: { c0: 'S1' } } } };
    const sheet = mount(GRID, data);
    sheet.select('A1');
    const source = { top: 0, left: 0, bottom: 0, right: 0 };
    const view = sheet.editor.view;
    const host = hosts.get(sheet.editor)!;
    await fill(view, host, { source, box: { ...source, bottom: 2 }, direction: 'down' }, 'series');
    const wrote = sheet.patches.at(-1) as { sheet?: { cells?: Record<string, unknown> } } | undefined;
    expect(Object.keys(wrote?.sheet?.cells ?? {}).sort()).toEqual(['r1', 'r2']);
    const before = sheet.patches.length;
    await fill(view, host, { source, box: { ...source, bottom: 2 }, direction: 'down' }, 'values');
    expect(sheet.patches.length).toBe(before);
  });
});

describe('touch', () => {
  it('moves the end handle to extend the range, and the start handle to shrink it', () => {
    const sheet = mount(GRID, {}, true);
    sheet.select('B2');
    const view = sheet.editor.view;
    expect(selectRange(view, cellOf('B2'), cellOf('D4'))).toBe(true);
    expect(sheet.range()).toBe('B2:D4');
    const handles = view.dom.parentElement!.querySelectorAll('[data-sheet-handle]');
    expect(Array.from(handles).map((h) => (h as HTMLElement).dataset.sheetHandle)).toEqual(['start', 'end', 'fill']);
    // The end handle is dragged to C3 from the bottom right: the range keeps its top left corner.
    const end = view.dom.parentElement!.querySelector('[data-sheet-handle="end"]') as HTMLElement;
    pointer('pointerdown', end, 400, 120, 'touch');
    pointer('pointermove', end, 250, 75, 'touch');
    pointer('pointerup', end, 250, 75, 'touch');
    expect(sheet.range()).toBe('B2:C3');
    const start = view.dom.parentElement!.querySelector('[data-sheet-handle="start"]') as HTMLElement;
    pointer('pointerdown', start, 100, 30, 'touch');
    pointer('pointermove', start, 210, 65, 'touch');
    pointer('pointerup', start, 210, 65, 'touch');
    expect(sheet.range()).toBe('C3:C3');
  });

  it('opens the cell context menu after a long press, and selects the cell it is on', () => {
    vi.useFakeTimers();
    const sheet = mount(GRID, {}, true);
    const view = sheet.editor.view;
    const cell = view.dom.querySelectorAll('tr')[2].children[2] as HTMLElement;
    const menus: MouseEvent[] = [];
    document.addEventListener('contextmenu', (event) => menus.push(event));
    pointer('pointerdown', cell, 250, 75, 'touch');
    vi.advanceTimersByTime(300);
    expect(menus).toHaveLength(0);
    vi.advanceTimersByTime(300);
    expect(menus).toHaveLength(1);
    expect(menus[0].clientX).toBe(250);
    expect(sheet.range()).toBe('C3:C3');
  });

  it('does not open the menu when the finger moves, and a tap selects a cell', () => {
    vi.useFakeTimers();
    const sheet = mount(GRID, {}, true);
    const view = sheet.editor.view;
    const cell = view.dom.querySelectorAll('tr')[1].children[3] as HTMLElement;
    const menus: Event[] = [];
    document.addEventListener('contextmenu', (event) => menus.push(event));
    pointer('pointerdown', cell, 350, 45, 'touch');
    pointer('pointermove', cell, 350, 80, 'touch');
    vi.advanceTimersByTime(700);
    expect(menus).toHaveLength(0);
    pointer('pointerdown', cell, 350, 45, 'touch');
    pointer('pointerup', cell, 350, 45, 'touch');
    expect(sheet.range()).toBe('D2:D2');
  });
});

describe('pen in Draw border mode', () => {
  const stroke = (sheet: Mounted, points: [number, number][]) => {
    const dom = sheet.editor.view.dom;
    pointer('pointerdown', dom, points[0][0], points[0][1], 'pen');
    points.slice(1).forEach(([x, y]) => pointer('pointermove', dom, x, y, 'pen'));
    const last = points[points.length - 1];
    pointer('pointerup', dom, last[0], last[1], 'pen');
  };

  it('sets bottom borders on B2, C2, and D2 for a stroke along their bottom edge', async () => {
    const sheet = mount(GRID, {}, true);
    setBorderMode('draw');
    stroke(sheet, [
      [105, 61],
      [200, 59],
      [300, 60],
      [395, 61],
    ]);
    await vi.waitFor(() => expect(sheet.patches.length).toBe(1));
    // Apply the patch to the sheet as the block does, and resolve the cells.
    const written = sheet.patches[0] as { sheet: Record<string, unknown> };
    const table = { columns: COL_IDS.map((id) => ({ id })), rows: ROW_IDS.map((id) => ({ id, cells: {} })) };
    const resolved = readSheet({ sheet: written.sheet });
    for (const column of ['c1', 'c2', 'c3']) {
      expect(resolve(resolved, table, 'r1', column).style.border?.b).toEqual({ style: 'thin' });
      expect(resolve(resolved, table, 'r2', column).style.border?.t).toEqual({ style: 'thin' });
    }
    expect(resolve(resolved, table, 'r1', 'c0').style.border?.b).toBeUndefined();
    expect(resolve(resolved, table, 'r1', 'c4').style.border?.b).toBeUndefined();
  });

  it('erases the borders in Erase border mode, and draws nothing when the mode is off', async () => {
    const styles = { S1: { border: { b: { style: 'thin' } } } };
    const sheet = mount(GRID, { sheet: { styles, cells: { r1: { c1: 'S1', c2: 'S1' } } } }, true);
    stroke(sheet, [
      [105, 61],
      [395, 61],
    ]);
    expect(sheet.patches).toHaveLength(0);
    setBorderMode('erase');
    stroke(sheet, [
      [105, 61],
      [395, 61],
    ]);
    await vi.waitFor(() => expect(sheet.patches.length).toBe(1));
    const written = sheet.patches[0] as { sheet: Record<string, unknown> };
    const table = { columns: COL_IDS.map((id) => ({ id })), rows: ROW_IDS.map((id) => ({ id, cells: {} })) };
    expect(resolve(readSheet({ sheet: written.sheet }), table, 'r1', 'c1').style.border?.b).toBeUndefined();
  });
});

describe('Border modes and the menu after a drop, from the keyboard', () => {
  const key = (target: EventTarget, init: KeyboardEventInit) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));

  it('ends Draw border on Escape wherever the focus is, and says so once for two tables', () => {
    const first = mount(GRID, {}, true);
    const second = mount(GRID, {}, true);
    setBorderMode('draw');
    expect(first.said.length + second.said.length).toBe(1);
    expect(first.editor.view.dom.parentElement!.dataset.borderMode).toBe('draw');
    expect(second.editor.view.dom.parentElement!.dataset.borderMode).toBe('draw');
    // The focus is on the page body, as after running the command from the palette.
    key(document.body, { key: 'Escape' });
    expect(borderMode()).toBe('off');
    expect(first.editor.view.dom.parentElement!.dataset.borderMode).toBeUndefined();
    expect(second.editor.view.dom.parentElement!.dataset.borderMode).toBeUndefined();
    expect(first.said.length + second.said.length).toBe(2);
    // The listener goes with the mode: a later Escape is not stopped.
    const seen = vi.fn();
    document.addEventListener('keydown', seen);
    key(document.body, { key: 'Escape' });
    expect(seen).toHaveBeenCalled();
    document.removeEventListener('keydown', seen);
  });

  const dropFill = (sheet: Mounted) => {
    sheet.select('A1', 'A2');
    const view = sheet.editor.view;
    const handle = view.dom.parentElement!.querySelector('[data-sheet-handle="fill"]') as HTMLElement;
    pointer('pointerdown', handle, 100, 60, 'mouse');
    pointer('pointermove', handle, 50, 105, 'mouse');
    pointer('pointerup', handle, 50, 105, 'mouse');
  };

  it('keeps the focus in the table after a drop, so Ctrl+Z undoes the fill, and Alt+Down reaches the menu', async () => {
    const sheet = mount(GRID, {}, true);
    sheet.editor.view.focus();
    dropFill(sheet);
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).not.toBeNull());
    expect(sheet.texts().map((row) => row[0])).toEqual(['1', '3', '5', '7', '']);
    expect(document.activeElement).not.toBeInstanceOf(HTMLButtonElement);
    key(sheet.editor.view.dom, { key: 'ArrowDown', altKey: true });
    expect((document.activeElement as HTMLElement).textContent).toBe('Fill series');
    // Back in the table, undo takes the fill back and closes the menu.
    sheet.editor.view.focus();
    key(sheet.editor.view.dom, { key: 'z', ctrlKey: true });
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it('runs Fill series down from the keyboard command: 2026-01-02 down three rows is 01-03, 01-04', async () => {
    const sheet = mount([['2026-01-02', '', '', '', ''], ...GRID.slice(1)], {}, true);
    sheet.editor.view.focus();
    sheet.editor.view.dom.dispatchEvent(new FocusEvent('focusin'));
    sheet.select('A1', 'A3');
    activePointer()!.fillSeries('down');
    await vi.waitFor(() =>
      expect(
        sheet
          .texts()
          .map((row) => row[0])
          .slice(0, 3),
      ).toEqual(['2026-01-02', '2026-01-03', '2026-01-04']),
    );
  });
});

describe('typing in a cell', () => {
  it('writes nothing to the handles, so the key asks for no frame for them (nightly perf-typing-gate)', () => {
    const sheet = mount(GRID, {}, true);
    const view = sheet.editor.view;
    sheet.select('C3');
    const cell = (view.state.selection as CellSelection).$anchorCell.pos;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cell + 2)));
    const handles = view.dom.parentElement!.querySelector('[data-sheet-handle]')!.parentElement!;
    const writes = new MutationObserver(() => {});
    writes.observe(handles, { attributes: true, childList: true, subtree: true });
    // The sheet pointer plugin updates the layer on every transaction (plugin.ts).
    const layer = layers[layers.length - 1];
    for (const key of 'abc') {
      view.dispatch(view.state.tr.insertText(key));
      layer.update();
    }
    expect(writes.takeRecords()).toEqual([]);
    writes.disconnect();
    expect(sheet.texts()[2][2]).toBe('abc');
  });
});

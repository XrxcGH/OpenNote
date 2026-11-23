// @vitest-environment jsdom
/* eslint-disable opennote/feature-boundaries -- The test mounts the row virtualization that the table block loads late. */
// The measuring pass and the sheet render plugin in a long table, where row virtualization draws only some rows
// (features/page/tables/virtual). jsdom has no layout: a shrink cell measures as scale 1 and a frozen row sticks at
// 0px. That is enough to see which row each measured value lands on.
import type { Editor } from '@tiptap/core';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../../app/flags';
import { createBlockEditor } from '../../../../editor/extensions/kit';
import { DEFAULT_EDITING_VIEW } from '../../../../editor/host';
import type { EditorHost } from '../../../../editor/host';
import { newTableData, tableDataToDoc } from '../../../../editor/table/mapping';
import { drawnRows } from '../../../page/tables/virtual/key';
import { setRowWindow } from '../../../page/tables/virtual/plugin';
import '../../../page/tables/virtual/register';
import { applyToRange, type Sheet } from '../model';
import { measureTable } from './measure';
import { sheetRenderKey, sheetRenderPlugin } from './plugin';

const host: EditorHost = {
  settings: () => DEFAULT_EDITING_VIEW,
  flag: () => true,
  announce: () => {},
  openMenu: () => Promise.resolve(null),
  screenReader: () => false,
  spelling: () => null,
  selectBlocks: () => {},
};

beforeAll(() => {
  // jsdom has no layout, and no box for a range either.
  Range.prototype.getBoundingClientRect ??= () => new DOMRect();
});

describe('measureTable in a table that draws only some rows', () => {
  /** A table whose first row is frozen and drawn, then rows 2,500 to 2,509 drawn with a shrink cell each. */
  function partialTable(): HTMLElement {
    const table = document.createElement('table');
    const body = table.appendChild(document.createElement('tbody'));
    const row = (number: number, attr: string) => {
      const tr = body.appendChild(document.createElement('tr'));
      tr.setAttribute('aria-rowindex', String(number + 1));
      const td = tr.appendChild(document.createElement('td'));
      td.setAttribute('data-cell', '');
      td.setAttribute(attr, '');
      td.appendChild(document.createElement('p')).textContent = `row ${number}`;
      body.appendChild(document.createComment('row'));
    };
    row(0, 'data-frozen-row');
    for (let r = 2500; r < 2510; r += 1) row(r, 'data-shrink');
    return table;
  }

  it('keys every measured value by the row number the row says, not by its place among the drawn rows', () => {
    const found = measureTable(partialTable(), { apply: false });
    expect([...found.keys()].sort((a, b) => a - b)).toEqual([0, ...Array.from({ length: 10 }, (_, i) => 2500 + i)]);
    expect(found.get(0)?.get(0)?.['--cell-sticky-top']).toBe('0px');
    expect(found.get(2505)?.get(0)?.['--cell-shrink']).toBe('1');
  });

  it('measures the asked row numbers and the frozen rows', () => {
    const found = measureTable(partialTable(), { rows: new Set([2507]), apply: false });
    expect([...found.keys()].sort((a, b) => a - b)).toEqual([0, 2507]);
  });
});

describe('the sheet render plugin in a 3,000-row table', () => {
  let editors: Editor[] = [];
  let frames: FrameRequestCallback[] = [];
  beforeAll(() => initFlags('dev'));
  afterEach(() => {
    editors.forEach((editor) => {
      editor.view.dom.remove();
      editor.destroy();
    });
    editors = [];
    vi.unstubAllGlobals();
  });

  /** Runs the queued animation frames, and the frames they queue, a few rounds. */
  function flush(): void {
    for (let round = 0; round < 8 && frames.length > 0; round += 1) {
      const now = frames;
      frames = [];
      now.forEach((run) => run(0));
    }
  }

  /** A 3,000-row table whose first column shrinks its text to fit, with its first row frozen. */
  function mount(): Editor {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (run: FrameRequestCallback) => frames.push(run));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const blank = newTableData(3, 3000, false);
    const col = blank.columns[0].id;
    const data = {
      ...blank,
      rows: blank.rows.map((row, i) => ({ ...row, cells: { ...row.cells, [col]: { markdown: `Item ${i}` } } })),
    };
    const styled = applyToRange({}, data, [data.rows[0].id, col], [data.rows[2999].id, col], {
      align: { shrink: true },
    }).sheet;
    const sheet: Sheet = { ...styled, table: { freeze: { rows: 1 } } } as Sheet;
    const source = { sheet, table: data };
    // Kept out of the document: jsdom has no layout, so the page's scroll watcher would move the window on its own.
    const root = document.createElement('div');
    const editor = createBlockEditor(root, tableDataToDoc(data), { kind: 'table', block: 'b1', host });
    editor.registerPlugin(sheetRenderPlugin({ source: () => source, scheme: () => 'light' }));
    editors.push(editor);
    editor.view.dispatch(editor.state.tr.setMeta(sheetRenderKey, { refresh: true }));
    flush();
    return editor;
  }

  const body = (editor: Editor) => [...editor.view.dom.querySelector('tbody')!.childNodes];

  it('keeps the frozen row drawn, and measures the rows that scroll into view at their own numbers', () => {
    const editor = mount();
    setRowWindow(editor.view, { from: 2450, to: 2600 });
    flush();
    // The frozen row stays drawn first, with its sticky offset.
    expect(drawnRows(editor.state)?.[0]).toBe(0);
    const first = body(editor)[0] as HTMLElement;
    expect(first.nodeName).toBe('TR');
    expect(first.querySelector('td')?.getAttribute('data-frozen-row')).not.toBeNull();
    expect(first.querySelector('td')?.getAttribute('style')).toContain('--cell-sticky-top');
    // The rows far down were measured when they were drawn, and their cells show the values.
    const drawn = drawnRows(editor.state)!;
    const last = drawn[drawn.length - 1];
    expect(drawn[1]).toBeGreaterThan(2000);
    const measured = sheetRenderKey.getState(editor.state)!.measured;
    expect(measured.get(last)?.get(0)?.['--cell-shrink']).toBe('1');
    const cell = editor.view.dom.querySelector(`tr[aria-rowindex="${last + 1}"] td`);
    expect(cell?.getAttribute('style')).toContain('--cell-shrink');
    // Rows that are not drawn stay placeholder comments: no decoration wraps one in an element.
    expect(body(editor).every((node) => node.nodeName === 'TR' || node.nodeType === Node.COMMENT_NODE)).toBe(true);
  });

  it('keeps each measured value on its own row after a full measure', () => {
    const editor = mount();
    setRowWindow(editor.view, { from: 2450, to: 2600 });
    flush();
    // A resize or a new source measures again in full: the drawn rows keep their numbers.
    editor.view.dispatch(editor.state.tr.setMeta(sheetRenderKey, { refresh: true }));
    flush();
    const drawn = drawnRows(editor.state)!;
    const measured = sheetRenderKey.getState(editor.state)!.measured;
    for (const r of drawn) expect(measured.get(r)?.get(0)?.['--cell-shrink']).toBe('1');
    expect(measured.get(0)?.get(0)?.['--cell-sticky-top']).toBe('0px');
  });
});

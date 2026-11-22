import { Schema } from '@tiptap/pm/model';
import { EditorState } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formulaRefsKey, formulaRefsPlugin, showBarFormula, visitEdgeCells } from './refsPlugin';

const schema = new Schema({ nodes: { doc: { content: 'text*' }, text: {} } });

describe('the edge cells of a reference', () => {
  it('stays inside the table for a box as wide as column ZZZ', () => {
    // A1:ZZZ9999999 on a table of 10 columns and 1,500 rows. Column ZZZ is the 18,278th column.
    const box = { top: 0, left: 0, bottom: 9_999_998, right: 18_277 };
    let visits = 0;
    visitEdgeCells(
      box,
      () => 10,
      1500,
      () => {
        visits += 1;
        return true;
      },
    );
    // The top row's 10 cells, then the left cell of each other row: the right and bottom edges lie outside.
    expect(visits).toBe(10 + 1499);
  });

  it('visits only the edge of a box, each cell with the edges it draws', () => {
    const seen: string[] = [];
    visitEdgeCells(
      { top: 1, left: 1, bottom: 3, right: 3 },
      () => 5,
      5,
      (r, c, edges) => {
        seen.push(`${r}${c}${edges}`);
        return true;
      },
    );
    expect(seen).toEqual(['11tl', '12t', '13tr', '21l', '23r', '31bl', '32b', '33rb']);
  });

  it('stops as soon as the visitor says so', () => {
    let visits = 0;
    visitEdgeCells(
      { top: 0, left: 0, bottom: 99, right: 99 },
      () => 100,
      100,
      () => {
        visits += 1;
        return visits < 7;
      },
    );
    expect(visits).toBe(7);
  });
});

describe('the bar text sent to the table', () => {
  let frames: (() => void)[] = [];
  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (run: () => void) => frames.push(run));
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      frames[id - 1] = () => {};
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function fakeView() {
    let state = EditorState.create({ schema, plugins: [formulaRefsPlugin()] });
    const sent: Transaction[] = [];
    const view = {
      isDestroyed: false,
      get state() {
        return state;
      },
      dispatch(tr: Transaction) {
        sent.push(tr);
        state = state.apply(tr);
      },
    };
    return { view: view as unknown as EditorView, sent, bar: () => formulaRefsKey.getState(state)?.bar };
  }

  it('waits for the next frame, off the key handler, and sends one text per frame', () => {
    const { view, sent, bar } = fakeView();
    for (const text of ['=SUM(A1:J1', '=SUM(A1:J10', '=SUM(A1:J100', '=SUM(A1:J1000']) showBarFormula(view, text);
    expect(sent).toHaveLength(0);
    expect(frames).toHaveLength(1);
    frames[0]!();
    expect(sent).toHaveLength(1);
    expect(bar()).toBe('=SUM(A1:J1000');
  });

  it('clears at once when the bar lets go, and drops the frame still waiting', () => {
    const { view, sent, bar } = fakeView();
    showBarFormula(view, '=A1');
    frames[0]!();
    showBarFormula(view, '=B2');
    showBarFormula(view, null);
    expect(bar()).toBeNull();
    expect(sent).toHaveLength(2);
    frames[1]!();
    expect(sent).toHaveLength(2);
    expect(bar()).toBeNull();
  });
});

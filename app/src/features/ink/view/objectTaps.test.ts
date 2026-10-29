// @vitest-environment jsdom
// Text boxes while a draw tool is active (Beta 6, owner bug 5): which block a held tap lands on, what counts as a held
// tap, and which grips stay the objects tool's.
import { describe, expect, it, vi } from 'vitest';
import type { BlockJson } from '../../../services/pages/types';
import type { InkHost, InkSelection } from './host';
import { DWELL_MS, editTextAt, isDwellTap, objectAt, onObjectHandle, TAP_SLOP_PX } from './objectTaps';

interface Placed {
  block: Partial<BlockJson> & { id: string; type: string };
  box: { x: number; y: number; w: number; h: number };
}

function hostWith(placed: Placed[], selection: InkSelection = { blocks: [], strokes: [] }) {
  const elements = new Map(placed.map((p) => [p.block.id, document.createElement('div')]));
  const select = vi.fn();
  const host = {
    layer: {
      get: () => ({
        blocks: () => placed.map((p) => p.block),
        block: (id: string) => placed.find((p) => p.block.id === id)?.block ?? null,
        view: (id: string) => {
          const found = placed.find((p) => p.block.id === id);
          return found ? { element: elements.get(id)!, measure: () => found.box } : null;
        },
      }),
    },
    selection: { get: () => selection },
    select,
  } as unknown as InkHost;
  return { host, elements, select };
}

const box = (id: string, x: number, y: number, extra: Partial<BlockJson> = {}): Placed => ({
  block: { id, type: 'text', frame: { x, y }, ...extra } as Placed['block'],
  box: { x, y, w: 100, h: 40 },
});

describe('a held tap on a text box', () => {
  it('counts a press held still at least the dwell, and not a quick tap or a press that moved', () => {
    expect(isDwellTap(0, DWELL_MS, 0)).toBe(true);
    expect(isDwellTap(0, DWELL_MS - 1, 0)).toBe(false);
    expect(isDwellTap(0, DWELL_MS * 2, TAP_SLOP_PX + 1)).toBe(false);
  });

  it('finds the topmost floating block at a point, and none on the flow, a locked box, or empty page', () => {
    const flow: Placed = {
      block: { id: 'flow', type: 'text' } as Placed['block'],
      box: { x: 0, y: 0, w: 500, h: 500 },
    };
    const locked = box('locked', 300, 300, { lock: 'position' } as Partial<BlockJson>);
    const { host } = hostWith([flow, box('a', 10, 10), box('b', 50, 20), locked]);
    expect(objectAt(host, { x: 20, y: 20 })).toBe('a');
    expect(objectAt(host, { x: 60, y: 30 })).toBe('b');
    expect(objectAt(host, { x: 200, y: 200 })).toBeNull();
    expect(objectAt(host, { x: 320, y: 320 })).toBeNull();
  });
});

describe('the grips of a text box in a draw tool', () => {
  it('belong to the objects tool for a selected or edited block, and to the pen for a hovered one', () => {
    const { host, elements } = hostWith([box('a', 0, 0), box('b', 0, 100), box('c', 0, 200)], {
      blocks: ['a'],
      strokes: [],
    });
    const press = (block: string) => {
      const grip = document.createElement('div');
      grip.dataset.handle = 'grip';
      grip.dataset.block = block;
      document.body.append(grip);
      return { target: grip } as unknown as PointerEvent;
    };
    const editor = document.createElement('div');
    editor.tabIndex = 0;
    elements.get('b')!.append(editor);
    document.body.append(elements.get('b')!);
    editor.focus();
    expect(onObjectHandle(host, press('a'))).toBe(true);
    expect(onObjectHandle(host, press('b'))).toBe(true);
    expect(onObjectHandle(host, press('c'))).toBe(false);
    expect(onObjectHandle(host, { target: document.body } as unknown as PointerEvent)).toBe(false);
  });

  it('puts the caret in a selected box at a tap, and lets go of the selection', async () => {
    const { host, select } = hostWith([box('a', 0, 0)], { blocks: ['a'], strokes: [] });
    const text = {
      hit: vi.fn(() => Promise.resolve({ block: 'a', pos: 4, top: 0, bottom: 10 })),
      select: vi.fn(() => Promise.resolve(true)),
    };
    Object.assign(host, { text });
    expect(await editTextAt(host, 10, 10, ['a'])).toBe(true);
    expect(select).toHaveBeenCalledWith({ blocks: [], strokes: [] });
    expect(text.select).toHaveBeenCalledWith('a', 4, 4);
    expect(await editTextAt(host, 10, 10, ['other'])).toBe(false);
  });
});

// @vitest-environment jsdom
// Where a new picture or attachment goes on a freeform page when nothing is selected.
import { describe, expect, it } from 'vitest';
import type { MountedPage } from '../mount';
import { defaultPlacement } from './insert';

function freeformPage(
  titleBottom: number | null,
  boxes: { id: string; x: number; y: number; w: number; h: number }[] = [],
  active: string | null = null,
): MountedPage {
  const rect = (top: number, bottom: number) => ({ left: 0, top, bottom, height: bottom - top }) as DOMRect;
  return {
    pool: { active: () => (active ? { block: active } : null) },
    page: { initial: { view: { layout: 'freeform' } } },
    layer: {
      blocks: () => boxes,
      view: (id: string) => {
        const box = boxes.find((b) => b.id === id);
        return box ? { measure: () => box } : null;
      },
    },
    viewport: {
      viewport: { getBoundingClientRect: () => rect(0, 800) },
      toWorld: (x: number, y: number) => ({ x, y }),
    },
    title: titleBottom === null ? null : { element: { getBoundingClientRect: () => rect(108, titleBottom) } },
  } as unknown as MountedPage;
}

describe('defaultPlacement', () => {
  it('puts a new block under the page title, not on it', () => {
    const place = defaultPlacement(freeformPage(152));
    expect(place).toEqual({ kind: 'point', x: 48, y: 176 });
  });

  it('uses the top corner of the view on a page without a title band', () => {
    expect(defaultPlacement(freeformPage(null))).toEqual({ kind: 'point', x: 48, y: 48 });
  });

  it('goes below a block that is where the corner would put it', () => {
    const player = { id: 'a', x: 35, y: 100, w: 500, h: 120 };
    expect(defaultPlacement(freeformPage(null, [player]))).toEqual({ kind: 'point', x: 48, y: 244 });
    expect(defaultPlacement(freeformPage(null, [{ ...player, y: 600 }]))).toEqual({ kind: 'point', x: 48, y: 48 });
  });

  // Under the caret's block is a table: the picture goes below the table, never over its cells (walk 9 T1-D01-2).
  it('goes below the caret block and below a block that is right under it', () => {
    const text = { id: 'text', x: 48, y: 100, w: 600, h: 80 };
    const table = { id: 'table', x: 48, y: 204, w: 480, h: 120 };
    expect(defaultPlacement(freeformPage(null, [text, table], 'text'))).toEqual({ kind: 'point', x: 48, y: 348 });
    expect(defaultPlacement(freeformPage(null, [text], 'text'))).toEqual({ kind: 'point', x: 48, y: 204 });
  });
});

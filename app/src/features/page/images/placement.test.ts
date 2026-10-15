// @vitest-environment jsdom
// Where a new picture or attachment goes on a freeform page when nothing is selected.
import { describe, expect, it } from 'vitest';
import type { MountedPage } from '../mount';
import { defaultPlacement } from './insert';

function freeformPage(titleBottom: number | null): MountedPage {
  const rect = (top: number, bottom: number) => ({ left: 0, top, bottom, height: bottom - top }) as DOMRect;
  return {
    pool: { active: () => null },
    page: { initial: { view: { layout: 'freeform' } } },
    layer: { view: () => null },
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
});

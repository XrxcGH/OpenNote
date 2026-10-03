import { describe, expect, it } from 'vitest';
import { captionLayout } from './captionLayout';

const labels = { maximize: 'Maximize', restore: 'Restore' };

describe('captionLayout', () => {
  it('reports the Maximize button in physical pixels', () => {
    const layout = captionLayout({ x: 1188, y: 0, width: 46, height: 39 }, 1.5, labels, true);
    expect(layout).toEqual({
      maximize: { x: 1782, y: 0, width: 69, height: 58.5 },
      labels,
      snapLayouts: true,
    });
  });

  it('keeps 46 DIPs of width at 200% text, where the CSS width is halved and the ratio doubled', () => {
    const layout = captionLayout({ x: 548, y: 0, width: 23, height: 40 }, 3, labels, false);
    expect(layout.maximize.width / 1.5).toBe(46);
    expect(layout.snapLayouts).toBe(false);
  });

  it('copies the labels, so a later change to the caller never alters a report', () => {
    const mutable = { ...labels };
    const layout = captionLayout({ x: 0, y: 0, width: 46, height: 40 }, 1, mutable, false);
    mutable.maximize = 'Changed';
    expect(layout.labels.maximize).toBe('Maximize');
  });
});

import { describe, expect, it } from 'vitest';
import { buildScene, defaultViewport, panByFraction } from '../grapher';
import { SIZE, tickLabels } from './parts';

/** Wider than any digit or minus sign the label font draws (11 px). */
const CHAR = 0.62 * 11;

describe('tick labels', () => {
  // Panning moves the ticks a little at a time; at some offsets a tick sits just inside the right or top edge.
  const offsets = Array.from({ length: 41 }, (_, i) => (i - 20) / 200);

  it('keeps every number whole inside the plot, wherever the view is panned', () => {
    for (const dx of offsets) {
      for (const dy of offsets) {
        const view = panByFraction(defaultViewport(SIZE), dx, dy);
        for (const label of tickLabels(buildScene(view, SIZE, []))) {
          expect(label.x).toBeGreaterThanOrEqual(0);
          expect(label.x + label.text.length * CHAR).toBeLessThanOrEqual(SIZE.width);
          expect(label.y - 8).toBeGreaterThanOrEqual(0);
          expect(label.y).toBeLessThanOrEqual(SIZE.height);
        }
      }
    }
  });

  it('still numbers the axes in the default view', () => {
    const labels = tickLabels(buildScene(defaultViewport(SIZE), SIZE, []));
    expect(labels.filter((l) => l.key.startsWith('x')).map((l) => l.text)).toContain('2');
    expect(labels.filter((l) => l.key.startsWith('y')).map((l) => l.text)).toContain('2');
  });
});

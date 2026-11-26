// The plot keeps its last tick label inside the picture (walk 9, T4-D07-5).
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Plot } from './Plot';

describe('the plot', () => {
  it('leaves room for the last x tick label at the right edge', () => {
    const { container } = render(
      <Plot plot={{ xLabel: 't (s)', yLabel: 'v (V)', series: [{ name: 'v', x: [0, 0.005], y: [0, 5] }] }} />,
    );
    const svg = container.querySelector('svg')!;
    const width = svg.viewBox.baseVal.width;
    const labels = [...svg.querySelectorAll('text')].filter((text) => text.getAttribute('text-anchor') === 'middle');
    expect(labels.some((text) => text.textContent === '0.005')).toBe(true);
    for (const text of labels) {
      expect(text.getBBox().x + text.getBBox().width, text.textContent ?? '').toBeLessThanOrEqual(width);
    }
  });
});

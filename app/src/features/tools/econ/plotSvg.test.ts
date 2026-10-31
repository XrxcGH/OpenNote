import { describe, expect, it } from 'vitest';
import { isSvg } from '../subjects/figure/model';
import { ECON_TOOLS } from './tools';
import { plotSvg } from './plotSvg';
import { ok } from './forms';
import { Plot } from './Plot';
import { createElement } from 'react';

const props = {
  summary: 'Supply & demand <test>',
  xLabel: 'Quantity',
  yLabel: 'Price',
  curves: [
    {
      label: 'Demand',
      points: [
        [0, 10],
        [10, 0],
      ] as const,
    },
    {
      label: 'Supply',
      points: [
        [0, 0],
        [10, 10],
      ] as const,
    },
  ],
  areas: [
    {
      label: 'Consumer surplus 12.5',
      points: [
        [0, 10],
        [5, 5],
        [0, 5],
      ] as const,
    },
  ],
  marks: [{ label: 'E', x: 5, y: 5 }],
};

describe('Insert graph', () => {
  it('serializes a plot as one escaped, self-contained SVG with every area named', () => {
    const svg = plotSvg(props);
    expect(isSvg(svg)).toBe(true);
    expect(svg).toContain('Supply &amp; demand &lt;test&gt;');
    expect(svg).not.toContain('<test>');
    expect(svg).toContain('Consumer surplus 12.5');
    expect(svg).not.toContain('var(--');
  });
  it('gives an answer that draws a Plot a diagram, and any other answer none', () => {
    const drawn = ok('Equilibrium 5', [], createElement(Plot, props));
    expect(drawn.ok && drawn.diagram?.alt).toBe(props.summary);
    const plain = ok('Equilibrium 5');
    expect(plain.ok && plain.diagram).toBeUndefined();
  });
  it('is offered by the market form from its starting values', () => {
    const form = ECON_TOOLS.find((t) => t.id === 'markets')!.forms[0];
    const values = {
      text: Object.fromEntries(
        (typeof form.fields === 'function' ? form.fields({ text: {}, unit: {} }) : form.fields).map((f) => [
          f.id,
          f.initial ?? '',
        ]),
      ),
      unit: {},
    };
    const out = form.solve(values);
    expect(out.ok && out.diagram && isSvg(out.diagram.svg)).toBe(true);
  });
});

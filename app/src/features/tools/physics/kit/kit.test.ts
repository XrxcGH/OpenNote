import '../text';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { PHYSICS_TOOLS } from '../meta';
import { C, EPS0, K_E, MU0, U_MEV } from './constants';
import { fmt, q, tex } from './format';
import { currentInputs, fail, makeReader, parseNumber, readState, solveMode } from './read';
import { showRow } from './say';
import { niceStep, plotToSvg, TOKEN_PALETTE } from './svg';
import type { ModeDef, ToolSpec } from './types';
import { DIMS, fromSI, toSI } from './units';

describe('physics kit numbers', () => {
  it('writes numbers to 5 significant figures with a true minus and powers of ten', () => {
    expect(fmt(374.16573867739413)).toBe('374.17');
    expect(fmt(-0.25)).toBe('−0.25');
    expect(fmt(8.8541878188e-11)).toBe('8.8542×10⁻¹¹');
    expect(fmt(Number.NaN)).toBe('—');
    expect(fmt(Infinity)).toBe('∞');
    expect(tex(1.5e-7, 2)).toBe('1.5\\times10^{-7}');
    expect(q(12, 'mm')).toBe('12 mm');
  });

  it('reads typed numbers in the forms people write them', () => {
    expect(parseNumber(' 1.5e-3 ')).toBe(0.0015);
    expect(parseNumber('1.5×10^-3')).toBeCloseTo(0.0015, 15);
    expect(parseNumber('−2')).toBe(-2);
    expect(parseNumber('1,000')).toBe(1000);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNaN();
  });

  it('converts units both ways, temperatures with their offsets', () => {
    expect(toSI(1, 'length', 'ft')).toBe(0.3048);
    expect(fromSI(toSI(70, 'force', 'lbf'), 'force', 'lbf')).toBeCloseTo(70, 12);
    expect(toSI(0, 'temperature', '°C')).toBe(273.15);
    expect(toSI(32, 'temperature', '°F')).toBeCloseTo(273.15, 12);
    expect(toSI(212, 'temperature', '°F')).toBeCloseTo(373.15, 12);
    expect(toSI(1, 'energy', 'MeV')).toBeCloseTo(1.602176634e-13, 25);
    expect(toSI(1, 'activity', 'Ci')).toBe(3.7e10);
    for (const [dim, def] of Object.entries(DIMS))
      expect(
        def.units.some(([symbol]) => symbol === def.si),
        dim,
      ).toBe(true);
  });

  it('takes its constants from CODATA 2022', () => {
    expect(C).toBe(299_792_458);
    expect(EPS0).toBeCloseTo(8.8541878188e-12, 22);
    expect(MU0).toBeCloseTo(1.25663706127e-6, 16);
    expect(K_E).toBeCloseTo(8.9875517862e9, 0);
    expect(U_MEV).toBeCloseTo(931.49410372, 6);
  });
});

const mode: ModeDef = {
  id: 'test',
  label: 'kitPhysics.title',
  fields: [
    { id: 'L', label: 'kitPhysics.title', dim: 'length', unit: 'cm', initial: '50' },
    { id: 'v', label: 'kitPhysics.title', kind: 'vector', dim: 'speed', initial: '1, 2, 3' },
    {
      id: 'q',
      label: 'kitPhysics.title',
      kind: 'rows',
      initial: '1 2\n3 4',
      columns: [
        { label: 'kitPhysics.title', dim: 'charge', unit: 'nC' },
        { label: 'kitPhysics.title', dim: 'length' },
      ],
    },
  ],
  solve: (read) => ({
    ok: true,
    rows: [{ key: 'kitPhysics.title', value: read.num('L', 'positive'), dim: 'length', unit: 'cm' }],
    steps: [],
  }),
};

describe('physics kit fields', () => {
  it('reads numbers, vectors and rows into SI', () => {
    const read = makeReader(mode, { mode: 'test', text: {}, unit: {} }, 'SI');
    expect(read.num('L')).toBeCloseTo(0.5, 15);
    expect(read.vector('v', 3)).toEqual([1, 2, 3]);
    const rows = read.rows('q');
    expect(rows[0][0]).toBeCloseTo(1e-9, 24);
    expect(rows[1][0]).toBeCloseTo(3e-9, 24);
    expect(rows[1][1]).toBe(4);
  });

  it('uses the unit the person picked, and US units when the window shows them', () => {
    const picked = makeReader(mode, { mode: 'test', text: {}, unit: { L: 'mm' } }, 'SI');
    expect(picked.num('L')).toBeCloseTo(0.05, 15);
    const us = makeReader(mode, { mode: 'test', text: {}, unit: {} }, 'US');
    expect(us.num('L')).toBeCloseTo(50 * 0.3048, 12);
    expect(us.vector('v', 3)[0]).toBeCloseTo(0.3048, 15);
  });

  it('names the field to fix when a number is missing, wrong, or out of range', () => {
    const problem = (text: Record<string, string>) => {
      const outcome = solveMode(mode, { mode: 'test', text: { L: '50', ...text }, unit: {} }, 'SI');
      return outcome.ok ? null : outcome.problem;
    };
    expect(problem({ L: '' })?.key).toBe('kitPhysics.errors.missing');
    expect(problem({ L: 'x' })?.key).toBe('kitPhysics.errors.notNumber');
    expect(problem({ L: '-1' })?.key).toBe('kitPhysics.errors.positive');
    expect(problem({ L: '0' })?.labels?.field).toBe('kitPhysics.title');
    const read = makeReader(mode, { mode: 'test', text: { v: '1 2', q: '1 2 3' }, unit: {} }, 'SI');
    expect(() => read.vector('v', 3)).toThrow();
    expect(() => read.rows('q')).toThrow();
    expect(() => fail('kitPhysics.errors.failed')).toThrow();
  });

  it('turns infinite results into a problem instead of showing them', () => {
    const bad: ModeDef = {
      ...mode,
      solve: () => ({ ok: true, rows: [{ key: 'kitPhysics.title', value: 1 / 0 }], steps: [] }),
    };
    const outcome = solveMode(bad, { mode: 'test', text: {}, unit: {} }, 'SI');
    expect(outcome.ok ? null : outcome.problem.key).toBe('kitPhysics.errors.nonFinite');
  });

  it('keeps what was typed per mode and drops saved state that no longer fits', () => {
    const spec: ToolSpec = { id: 'test', modes: [mode, { ...mode, id: 'other' }] };
    const state = readState(spec, { mode: 'other', modes: { test: { text: { L: '7' } }, gone: {} } });
    expect(state.mode).toBe('other');
    expect(Object.keys(state.modes)).toEqual(['test']);
    expect(currentInputs(spec, { ...state, mode: 'test' }).inputs.text.L).toBe('7');
    expect(readState(spec, 'nonsense').mode).toBe('test');
  });

  it('shows a result in the unit system the window uses', () => {
    const row = { key: 'kitPhysics.title' as const, value: 1, dim: 'length' as const, unit: 'mm' };
    expect(showRow(row, 'SI')).toMatchObject({ value: '1000', unit: 'mm' });
    expect(showRow(row, 'US')).toMatchObject({ value: '3.2808', unit: 'ft' });
  });
});

describe('physics kit pictures', () => {
  it('picks round tick steps', () => {
    expect(niceStep(10)).toBe(2);
    expect(niceStep(0.37)).toBe(0.05);
    expect(niceStep(0)).toBe(1);
  });

  it('draws a plot as SVG with its name, axes and marks, and escapes text', () => {
    const svg = plotToSvg(
      {
        frame: 'axes',
        alt: { key: 'kitPhysics.title' },
        x: { label: 't (s)' },
        y: { label: 'a<b' },
        series: [
          {
            points: [
              [0, 0],
              [1, 1],
              [Number.NaN, 2],
              [2, 0],
            ],
          },
        ],
        circles: [{ x: 1, y: 1, r: 3, px: true, fill: true }],
        labels: [{ x: 0, y: 0, text: 'A&B' }],
        arrows: [{ x1: 0, y1: 0, x2: 1, y2: 0 }],
        legend: [{ tone: 'accent', key: 'kitPhysics.title' }],
      },
      TOKEN_PALETTE,
      'A "plot"',
    );
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('aria-label="A &quot;plot&quot;"');
    expect(svg).toContain('a&lt;b');
    expect(svg).toContain('A&amp;B');
    expect(svg).toContain('var(--color-accent-primary)');
    expect(svg.match(/<path d="M/g)?.length).toBeGreaterThan(0);
    // The NaN point breaks the line into two pieces.
    expect(svg).toMatch(/d="M[^"]*M/);
  });
});

describe('physics kit registration', () => {
  it('registers a palette command for every tool in the window, and no other', () => {
    // The registration loads at start-up, so it keeps its own copy of the list; it is read here as text because
    // features import each other only through their index files.
    const source = readFileSync(new URL('../../../page/registrations/kitPhysics.ts', import.meta.url), 'utf8');
    const list = /PHYSICS_COMMAND_TOOLS[^=]*=\s*\[([\s\S]*?)\];/.exec(source)?.[1] ?? '';
    const pairs = [...list.matchAll(/\['(\w+)',\s*'(\w+)'\]/g)].map((m) => ({ id: m[1], icon: m[2] }));
    expect(pairs).toEqual(PHYSICS_TOOLS.map(({ id, icon }) => ({ id, icon })));
  });
});

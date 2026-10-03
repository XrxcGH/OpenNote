import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { keepWeights } from './phosphor-weights.ts';

const DEFS = join(import.meta.dirname, '..', '..', 'node_modules', '@phosphor-icons', 'react', 'dist', 'defs');

/** Runs an icon module's source with React supplied, and returns the Map it exports as its default. */
function weightsOf(source: string): Map<string, unknown> {
  const react = /^import \* as (\w+) from "react";/m.exec(source)?.[1] ?? 'react';
  const body = source.replace(/^import .*$/m, '').replace(/export \{[\s\S]*?\};?\s*$/m, '');
  const exported = /const (\w+) = /.exec(body)?.[1];
  return new Function(react, `${body}; return ${exported};`)({ createElement, Fragment: Symbol.for('react.fragment') });
}

describe('keepWeights', () => {
  const moon = readFileSync(join(DEFS, 'Moon.es.js'), 'utf8');

  it("leaves Phosphor's real icon modules with the regular and fill weights only", () => {
    expect([...weightsOf(moon).keys()].sort()).toEqual(['bold', 'duotone', 'fill', 'light', 'regular', 'thin']);
    const kept = keepWeights(moon, ['regular', 'fill'], 'Moon');
    expect([...weightsOf(kept).keys()]).toEqual(['fill', 'regular']);
    expect(kept.length).toBeLessThan(moon.length / 2);
  });

  it('keeps the drawings themselves, not just the names', () => {
    const [before, after] = [moon, keepWeights(moon, ['regular'], 'Moon')].map(weightsOf);
    expect(JSON.stringify(after.get('regular'))).toBe(JSON.stringify(before.get('regular')));
  });

  it('works on every icon the interface imports', () => {
    for (const name of ['Books', 'CloudSlash', 'ArrowsClockwise', 'DotsThree', 'Trash']) {
      const source = readFileSync(join(DEFS, `${name}.es.js`), 'utf8');
      expect([...weightsOf(keepWeights(source, ['regular', 'fill'], name)).keys()]).toEqual(['fill', 'regular']);
    }
  });

  it('fails loudly when a module has changed shape', () => {
    expect(() => keepWeights('export default 1;', ['regular'], 'Odd')).toThrow(/no Map of weights/);
    expect(() => keepWeights(moon, ['regular', 'sharp'], 'Moon')).toThrow(/no sharp weight/);
  });
});

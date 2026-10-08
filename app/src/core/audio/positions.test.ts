// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PositionMap } from './positions';

/** The cases that crates/media/tests/shared_fixtures.rs also passes. */
const cases = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../../../../crates/media/tests/fixtures/position-map.json', import.meta.url)),
    'utf8',
  ),
) as {
  ranges: [number, number][];
  durationNs: number;
  spans: unknown[];
  locate: { captureNs: number; positionNs: number; exact: boolean }[];
  captureAt: { positionNs: number; captureNs: number | null }[];
};

describe('PositionMap', () => {
  const map = PositionMap.fromRanges(cases.ranges);

  it('builds the same spans as the Rust map', () => {
    expect(map.spans).toEqual(cases.spans);
    expect(map.durationNs).toBe(cases.durationNs);
  });

  it('places capture times the way the Rust map does', () => {
    for (const { captureNs, positionNs, exact } of cases.locate) {
      expect(map.locate(captureNs), `at ${captureNs}`).toEqual({ positionNs, exact });
    }
  });

  it('turns positions back into capture times', () => {
    for (const { positionNs, captureNs } of cases.captureAt) {
      expect(map.captureAt(positionNs), `at ${positionNs}`).toBe(captureNs);
    }
  });

  it('has no audio when it has no stretches', () => {
    const empty = new PositionMap([]);
    expect(empty.durationNs).toBe(0);
    expect(empty.locate(5)).toEqual({ positionNs: 0, exact: false });
    expect(empty.captureAt(0)).toBeNull();
  });

  it('reads the data the host sends', () => {
    expect(PositionMap.fromData({ spans: [...cases.spans] as never }).durationNs).toBe(cases.durationNs);
  });
});

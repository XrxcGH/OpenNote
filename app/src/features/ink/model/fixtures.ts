// Strokes with valid IDs for tests and benchmarks. A record's IDs are 26 characters of Crockford base 32 (spec 2.4),
// so the geometry fixtures' short IDs do not encode.

import { seededRandom } from '../geometry/fixtures';
import type { InkPoint } from '../geometry/types';
import { PENS } from '../pens/palette';
import type { InkStroke } from './types';

const DIGITS = '0123456789abcdefghjkmnpqrstvwxyz';

/** A valid ID that is the same for the same number, and different for different numbers up to 2^40. */
export function testId(n: number): string {
  let rest = Math.floor(n);
  let tail = '';
  for (let i = 0; i < 8; i++) {
    tail = DIGITS[rest % 32] + tail;
    rest = Math.floor(rest / 32);
  }
  return `0${'0'.repeat(17)}${tail}`;
}

export const TEST_BLOCK = testId(0xb10c);

/** A stroke of `count` points along a gentle curve, with every channel, that encodes as a record. */
export function inkStroke(n: number, count = 40, extra: Partial<InkStroke> = {}): InkStroke {
  const random = seededRandom(n + 7);
  const pen = PENS[n % PENS.length];
  const points: InkPoint[] = [];
  let x = random() * 800;
  let y = random() * 1200;
  let heading = random() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    points.push({
      x,
      y,
      pressure: 0.2 + random() * 0.7,
      tiltX: Math.round((random() - 0.5) * 80),
      tiltY: Math.round((random() - 0.5) * 80),
      time: i * 8,
    });
    heading += (random() - 0.5) * 0.7;
    x += Math.cos(heading) * 1.5;
    y += Math.sin(heading) * 1.5;
  }
  return {
    id: testId(n + 1),
    block: TEST_BLOCK,
    tool: 'pen',
    width: 2,
    startTime: 1_700_000_000_000 + n * 1000,
    slot: pen.slot,
    color: pen.light,
    points,
    ...extra,
  };
}

import { afterEach, describe, expect, it } from 'vitest';
import { CHANNEL_PRESSURE, encodePoints, encodeRecords } from '../../../core/ink/codec';
import { exportInkSources } from '../../../registries';
import { collectStrokes } from './strokes';

const PAGE = '01k6f00000000000000000p001';
const LAYER = '01k6f00000000000000000k001';

function records(): Uint8Array {
  const points = [
    { x: 640, y: 1280, pressure: 65535, tiltX: 0, tiltY: 0, t: 0 },
    { x: 1280, y: 1920, pressure: 0, tiltX: 0, tiltY: 0, t: 0 },
  ];
  const { bytes, bbox } = encodePoints(points, CHANNEL_PRESSURE);
  return encodeRecords([
    {
      kind: 'stroke',
      stroke: {
        id: '01k6f00000000000000000s001',
        block: LAYER,
        start: 1_790_000_000_000,
        startUnknown: false,
        style: { tool: 2, palette: 32, color: [255, 220, 0, 128], width: 12 },
        bbox,
        channels: CHANNEL_PRESSURE,
        pointCount: 2,
        transform: null,
        origin: null,
        points: bytes,
      },
    },
  ]);
}

let stops: (() => void)[] = [];
afterEach(() => {
  stops.forEach((stop) => stop());
  stops = [];
});

describe('export strokes from the registered ink sources', () => {
  it('decodes each source’s records into strokes in page units', async () => {
    stops.push(
      exportInkSources.register({ id: 'ink', records: (page) => Promise.resolve(page === PAGE ? records() : null) }),
    );
    const [stroke, ...rest] = await collectStrokes(PAGE);
    expect(rest).toEqual([]);
    expect(stroke).toMatchObject({ block: LAYER, tool: 2, color: [255, 220, 0, 128], width: 12 });
    expect(Array.from(stroke!.x)).toEqual([10, 20]);
    expect(Array.from(stroke!.y)).toEqual([20, 30]);
    expect(Array.from(stroke!.pressure ?? [])).toEqual([1, 0]);
    expect(await collectStrokes('01k6f00000000000000000p002')).toEqual([]);
  });

  it('leaves out a source that fails or holds records it can’t read', async () => {
    stops.push(
      exportInkSources.register({ id: 'broken', records: () => Promise.reject(new Error('gone')) }),
      exportInkSources.register({ id: 'damaged', records: () => Promise.resolve(new Uint8Array([1, 2, 3])) }),
      exportInkSources.register({ id: 'ink', records: () => Promise.resolve(records()) }),
    );
    expect(await collectStrokes(PAGE)).toHaveLength(1);
  });
});

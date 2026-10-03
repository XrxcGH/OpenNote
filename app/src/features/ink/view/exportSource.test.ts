import { afterEach, describe, expect, it } from 'vitest';
import { CHANNEL_PRESSURE, encodePoints, encodeRecords } from '../../../core/ink/codec';
import { exportStrokeSources } from '../../pages';
import { registerExportStrokes } from './exportSource';
import type { InkSurface } from './surface';

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

const surfaceFor = (id: string) =>
  ({ parts: { page: { id, ink: { readAll: () => Promise.resolve(records()) } } } }) as unknown as InkSurface;

let stop: (() => void) | null = null;
afterEach(() => {
  stop?.();
  stop = null;
});

describe('ink as an export stroke source', () => {
  it('gives export the shown page’s strokes in page units', async () => {
    stop = registerExportStrokes(() => surfaceFor(PAGE));
    const [source] = exportStrokeSources.list();
    const [stroke] = await source!.strokes(PAGE);
    expect(stroke).toMatchObject({ block: LAYER, tool: 2, color: [255, 220, 0, 128], width: 12 });
    expect(Array.from(stroke!.x)).toEqual([10, 20]);
    expect(Array.from(stroke!.y)).toEqual([20, 30]);
    expect(Array.from(stroke!.pressure ?? [])).toEqual([1, 0]);
  });

  it('gives nothing for a page that isn’t shown, or with no page shown', async () => {
    stop = registerExportStrokes(() => surfaceFor(PAGE));
    expect(await exportStrokeSources.list()[0]!.strokes('01k6f00000000000000000p002')).toEqual([]);
    stop();
    stop = registerExportStrokes(() => null);
    expect(await exportStrokeSources.list()[0]!.strokes(PAGE)).toEqual([]);
  });
});

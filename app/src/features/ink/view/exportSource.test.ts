import { afterEach, describe, expect, it } from 'vitest';
import { CHANNEL_PRESSURE, encodePoints, encodeRecords } from '../../../core/ink/codec';
import { exportInkSources } from '../../../registries';
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

describe('ink as an export ink source', () => {
  it('gives export the shown page’s strokes as segment records', async () => {
    stop = registerExportStrokes(() => surfaceFor(PAGE));
    expect(await exportInkSources.list()[0]!.records(PAGE)).toEqual(records());
  });

  it('gives nothing for a page that isn’t shown, or with no page shown', async () => {
    stop = registerExportStrokes(() => surfaceFor(PAGE));
    expect(await exportInkSources.list()[0]!.records('01k6f00000000000000000p002')).toBeNull();
    stop();
    stop = registerExportStrokes(() => null);
    expect(await exportInkSources.list()[0]!.records(PAGE)).toBeNull();
  });
});

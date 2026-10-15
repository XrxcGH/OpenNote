// The scene of a narrated video: the strokes that were drawn during the recording, at the recording's own times and in
// the picture's pixels; the strokes outside it left out; and the call the host gets.
import { afterEach, describe, expect, it } from 'vitest';
import { moreOver } from '../../../core/audio';
import type { RecordingEntry } from '../../../core/audio';
import { entry } from '../../../core/audio/fake';
import type { PageRaster } from '../../pages';
import { setInkStrokeReader } from '../seams/inkStrokes';
import { sceneFor } from './exportVideo';

// The recording began at Unix 1_000_000 ms, which was capture time 10 s, and ran for 20 s.
const recording: RecordingEntry = {
  ...entry('r1'),
  startedNs: 10_000_000_000,
  endedNs: 30_000_000_000,
  clock: { captureNs: 10_000_000_000, unixMs: 1_000_000 },
};

const raster: PageRaster = {
  width: 200,
  height: 100,
  rgba: new Uint8ClampedArray(200 * 100 * 4),
  scale: 2,
  origin: { x: 10, y: 20 },
  strokes: [
    { id: 'in', color: [10, 20, 30, 255], width: 3 },
    { id: 'before', color: [0, 0, 0, 255], width: 3 },
  ],
};

let forget: (() => void) | null = null;
afterEach(() => forget?.());

describe('the scene of a video', () => {
  it('puts the strokes of the recording in pixels at the recording’s times', () => {
    const strokes = [
      {
        id: 'in',
        startTime: 1_005_000,
        points: [
          { x: 20, y: 30, time: 0 },
          { x: 30, y: 40, time: 100 },
        ],
      },
      { id: 'before', startTime: 900_000, points: [{ x: 1, y: 1, time: 0 }] },
    ];
    forget = setInkStrokeReader({
      all: () => strokes,
      get: (ids) => strokes.filter((one) => ids.includes(one.id)),
    });
    const scene = sceneFor(recording, raster);
    expect(scene.width).toBe(200);
    expect(scene.strokes).toHaveLength(1);
    const [stroke] = scene.strokes;
    expect(stroke?.width).toBe(6);
    expect(stroke?.points).toEqual([
      { x: 20, y: 20, tNs: 15_000_000_000 },
      { x: 40, y: 40, tNs: 15_100_000_000 },
    ]);
  });

  it('has the page and the sound alone when the recording has no clock', () => {
    const { clock: _clock, ...bare } = recording;
    expect(sceneFor(bare, raster).strokes).toEqual([]);
  });
});

describe('the host call', () => {
  it('sends the strokes and then the picture as one body, with the rest in a header', async () => {
    const seen: { command: string; body: Uint8Array; header: string }[] = [];
    const host = moreOver((command, args, options) => {
      seen.push({ command, body: args as Uint8Array, header: options?.headers?.['x-opennote-video'] ?? '' });
      return Promise.resolve(1234);
    });
    const size = await host.exportVideo(
      'assets',
      recording,
      { dest: 'C:/out.mp4' },
      {
        width: 2,
        height: 1,
        rgba: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]),
        strokes: [],
      },
    );
    expect(size).toBe(1234);
    const call = seen[0];
    expect(call?.command).toBe('audio_export_video');
    const header = JSON.parse(decodeURIComponent(call?.header ?? '')) as { strokesLen: number; width: number };
    expect(header.strokesLen).toBe(2);
    expect(header.width).toBe(2);
    expect([...(call?.body.slice(2) ?? [])]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});

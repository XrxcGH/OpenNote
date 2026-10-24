import { describe, expect, it } from 'vitest';
import { decodeRecords, encodePoints, encodeRecords, CHANNEL_PRESSURE } from '../../../core/ink/codec';
import type { Stroke } from '../../../core/ink/codec';
import { CONTRACT_PAGE } from '../contract';
import type { InkChanges } from '../ink';
import type { EditBatch } from '../types';
import { createMemoryPageService } from '.';

const LAYER = '01k6f00000000000000000k001';
const S1 = '01k6f00000000000000000s001';
const S2 = '01k6f00000000000000000s002';

function record(id: string, start = 1_790_000_000_000): Uint8Array {
  const points = [
    { x: 640, y: 1280, pressure: 30000, tiltX: 0, tiltY: 0, t: 0 },
    { x: 720, y: 1440, pressure: 32000, tiltX: 0, tiltY: 0, t: 0 },
  ];
  const { bytes, bbox } = encodePoints(points, CHANNEL_PRESSURE);
  const stroke: Stroke = {
    id,
    block: LAYER,
    start,
    startUnknown: false,
    style: { tool: 0, palette: 1, color: [43, 37, 33, 255], width: 2 },
    bbox,
    channels: CHANNEL_PRESSURE,
    pointCount: 2,
    transform: null,
    origin: null,
    points: bytes,
  };
  return encodeRecords([{ kind: 'stroke', stroke }]);
}

const layer: EditBatch['edits'] = [
  { edit: 'insertBlock', block: { id: LAYER, type: 'ink', frame: { x: 0, y: 0 }, data: { role: 'layer' } } },
];
const ids = (bytes: Uint8Array) => decodeRecords(bytes).map((r) => (r.kind === 'stroke' ? r.stroke.id : r.kind));

async function open() {
  const service = createMemoryPageService([{ page: CONTRACT_PAGE }]);
  const page = await service.open(CONTRACT_PAGE.id, { viewport: null });
  const heard: InkChanges[] = [];
  page.ink!.onChange((changes) => heard.push(changes));
  return { service, page, heard };
}

describe('ink in the memory page service', () => {
  it('adds strokes with their layer as one step that undo and redo take back and bring back', async () => {
    const { service, page, heard } = await open();
    await page.send({ edits: layer, strokes: record(S1) });
    expect(ids(await page.ink!.readAll())).toEqual([S1]);
    expect(page.initial).not.toHaveProperty('memoryInk');

    const undone = await page.undo();
    expect(undone?.ink?.removed).toEqual([S1]);
    expect(undone?.removed).toEqual([LAYER]);
    expect(heard.at(-1)?.removed).toEqual([S1]);

    const redone = await page.redo();
    expect(redone?.ink?.added).toEqual([S1]);
    expect(ids(redone!.ink!.records)).toEqual([S1]);
    const again = await service.open(CONTRACT_PAGE.id, { viewport: null });
    expect(ids(again.ink!.records)).toEqual([S1]);
  });

  it('removes, transforms, and restyles strokes, and refuses a stroke with no ink block', async () => {
    const { page } = await open();
    await expect(page.send({ edits: [], strokes: record(S1) })).rejects.toMatchObject({ code: 'invalid' });
    await page.send({
      edits: layer,
      strokes: encodeRecords([...decodeRecords(record(S1)), ...decodeRecords(record(S2, 2e12))]),
    });
    await page.send({ edits: [{ edit: 'transformStrokes', strokes: [S1], matrix: [2, 0, 0, 2, 10, 0] }] });
    await page.send({ edits: [{ edit: 'restyleStrokes', strokes: [S2], style: { width: 4 } }] });
    const all = decodeRecords(await page.ink!.readAll()).flatMap((r) => (r.kind === 'stroke' ? [r.stroke] : []));
    expect(all.map((s) => [s.id, s.transform, s.style.width])).toEqual([
      [S1, [2, 0, 0, 2, 10, 0], 2],
      [S2, null, 4],
    ]);
    const restyleUndone = await page.undo();
    expect(restyleUndone?.ink?.changed).toEqual([S2]);
    await page.send({
      edits: [{ edit: 'removeStrokes', strokes: [S1, S2] }],
      coalesce: { kind: 'erase', target: 'e' },
    });
    expect(ids(await page.ink!.readAll())).toEqual([]);
    await expect(page.send({ edits: [{ edit: 'removeStrokes', strokes: [S1] }] })).rejects.toMatchObject({
      code: 'notFound',
    });
  });
});

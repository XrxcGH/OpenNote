// @vitest-environment jsdom
// A stroke after an undo back to an empty page makes a new ink layer: the old one is gone from the page.
import { describe, expect, it, vi } from 'vitest';
import type { BlockJson, EditBatch, OpenPage } from '../../../services/pages/types';
import { inkStroke } from '../model/fixtures';
import type { InkStroke } from '../model/types';
import type { InkBlockLayer, InkCamera, InkQueue, InkViewport } from './host';
import { InkSurface } from './surface';

vi.mock('../../../ui', async (original) => ({ ...(await original<object>()), showToast: vi.fn() }));

const camera: InkCamera = {
  zoom: 1,
  scrollX: 0,
  scrollY: 0,
  dpr: 1,
  viewport: { x: 0, y: 0, w: 400, h: 300 },
  gesture: null,
  seq: 0,
};

function setup() {
  const host = document.createElement('div');
  const scroller = document.createElement('div');
  host.append(scroller);
  document.body.append(host);
  const blocks = new Map<string, BlockJson>();
  const layer: InkBlockLayer = {
    blocks: () => [...blocks.values()],
    block: (id) => blocks.get(id) ?? null,
    upsert: (block) => void blocks.set(block.id, block),
    view: () => null,
  };
  const sent: EditBatch[] = [];
  const queue: InkQueue = {
    send: (batch) => {
      sent.push(batch);
      return Promise.resolve({} as never);
    },
    undo: () => Promise.resolve(),
    redo: () => Promise.resolve(),
  };
  const viewport = {
    viewport: scroller,
    world: scroller,
    camera: () => camera,
    onCamera: () => () => undefined,
  } as unknown as InkViewport;
  const page = { initial: { blocks: [] }, ink: null, readOnly: null } as unknown as OpenPage;
  const surface = new InkSurface({ page, viewport, queue, layer });
  return { surface, blocks, sent };
}

const stroke = (n: number, block: string): InkStroke => inkStroke(n, 8, { block });

const layerInserts = (batch: EditBatch) => batch.edits.filter((edit) => edit.edit === 'insertBlock').length;

describe('the ink layer after an undo to an empty page', () => {
  it('makes a new layer for the next stroke when the old one was removed', async () => {
    const { surface, blocks, sent } = setup();
    const first = surface.layerFor();
    await surface.add([stroke(1, first)]);
    expect(layerInserts(sent[0]!)).toBe(1);

    // The undo takes the layer block out of the page.
    blocks.delete(first);
    surface.applyChanges({ removed: [stroke(1, first).id], records: new Uint8Array() } as never);

    const next = surface.layerFor();
    expect(next).not.toBe(first);
    await surface.add([stroke(2, next)]);
    expect(layerInserts(sent[1]!)).toBe(1);
  });

  it('keeps the layer while the page still holds it', async () => {
    const { surface, sent } = setup();
    const first = surface.layerFor();
    await surface.add([stroke(1, first)]);
    expect(surface.layerFor()).toBe(first);
    await surface.add([stroke(2, first)]);
    expect(layerInserts(sent[1]!)).toBe(0);
  });
});

// The Tauri page service over a fake core client: history calls, frames from other clients' changes, external
// changes, and read-only notices.
import { describe, expect, it, vi } from 'vitest';
import type { CoreClient, DecodedEnvelope } from '../../core/client';
import type { ImagesClient } from '../../platform/types';
import { createTauriPageService, readOnlyInfo, toVersionInfo } from './tauri';

const AT = '2026-10-01T09:00:00.000Z';
const block = (id: string, markdown: string) => ({
  id,
  type: 'text',
  order: id,
  created: AT,
  modified: AT,
  data: { markdown },
});

function envelope(blocks: object[], readOnly: string | null = null): DecodedEnvelope {
  return {
    session: {
      page: 'core',
      revision: 'r',
      clientSeq: 3,
      readOnly,
      canUndo: true,
      canRedo: false,
    } as DecodedEnvelope['session'],
    page: { id: 'p1', title: 'T', blocks, assets: {} },
    readOnly: readOnly !== null,
    moreInk: false,
    strokes: 0,
    ink: new Uint8Array(),
  };
}

function fakeCore(pages: DecodedEnvelope[]) {
  const handlers = new Map<string, (payload: unknown) => void>();
  const core = {
    pageOpen: vi.fn(() => Promise.resolve(pages.shift() ?? pages.at(-1)!)),
    pageApply: vi.fn(() => Promise.resolve({ seq: 1, orderKeys: {}, canUndo: true, canRedo: false })),
    pageClose: vi.fn(() => Promise.resolve()),
    historyList: vi.fn(() =>
      Promise.resolve([
        { revision: 'v1', savedAt: AT, reason: 'save', name: null, keep: false, device: { id: 'd', label: 'Laptop' } },
      ]),
    ),
    historyRestoreBlocks: vi.fn(() => Promise.resolve({ seq: 2, orderKeys: {}, canUndo: true, canRedo: false })),
    historyRestore: vi.fn(() => Promise.resolve({ kind: 'restored' as const })),
    onEvent: vi.fn((event: string, handler: (payload: unknown) => void) => {
      handlers.set(event, handler);
      return () => void handlers.delete(event);
    }),
  };
  return {
    core: core as unknown as CoreClient,
    calls: core,
    emit: (event: string, payload: unknown) => handlers.get(event)?.(payload),
  };
}

const images = {} as ImagesClient;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('the Tauri page service', () => {
  it('maps versions and read-only reasons from the core', () => {
    expect(
      toVersionInfo({
        revision: 'v1',
        savedAt: AT,
        reason: 'save',
        name: 'Exam',
        keep: true,
        device: { label: 'Laptop' },
      }),
    ).toEqual({ revision: 'v1', savedAt: AT, reason: 'save', device: 'Laptop', name: 'Exam', keep: true });
    expect(readOnlyInfo('damagedInk')).toEqual({ reason: 'damagedInk', action: 'repairInk' });
    expect(readOnlyInfo('damaged')).toEqual({ reason: 'damaged', action: null });
  });

  it('lists versions, and restores blocks as a frame of the page the core now holds', async () => {
    const { core, calls } = fakeCore([envelope([block('a', 'Now')]), envelope([block('a', 'Then')])]);
    const page = await createTauriPageService(core, images).open('p1', { viewport: null });
    expect(await page.history.list()).toMatchObject([{ revision: 'v1', device: 'Laptop' }]);
    const frame = await page.history.restoreBlocks('v1', ['a', 'gone']);
    expect(calls.historyRestoreBlocks).toHaveBeenCalledWith({
      page: 'p1',
      client: page.client,
      clientSeq: 4,
      revision: 'v1',
      blocks: ['a', 'gone'],
    });
    expect(frame.blocks.map((b) => b.data.markdown)).toEqual(['Then']);
    expect(frame.removed).toEqual(['gone']);
    const reloaded = vi.fn();
    page.onExternal(reloaded);
    await expect(page.history.restore('v1', false)).resolves.toEqual({ page: 'p1', asCopy: false });
    expect(reloaded).toHaveBeenCalledWith({ action: 'reloaded' });
  });

  it('turns the core’s events for the page into frames, external changes, and read-only notices', async () => {
    const { core, emit } = fakeCore([envelope([block('a', 'One')]), envelope([block('a', 'Two')])]);
    const page = await createTauriPageService(core, images).open('p1', { viewport: null });
    const frames = vi.fn();
    const external = vi.fn();
    const readOnly = vi.fn();
    page.onFrame(frames);
    page.onExternal(external);
    page.onReadOnly(readOnly);
    const changes = { pageFields: false, blocksChanged: ['a'], blocksRemoved: [], assetsChanged: [] };
    emit('core:txn-applied', { page: 'p1', sourceClient: page.client, changes });
    emit('core:txn-applied', { page: 'other', sourceClient: 'main-9', changes });
    emit('core:txn-applied', { page: 'p1', sourceClient: 'main-9', changes });
    emit('core:external-change', { page: 'p1', action: { kind: 'conflict', otherDevice: 'Desk' } });
    emit('core:read-only', { page: 'p1', reason: { kind: 'readOnlyFile' } });
    await settle();
    expect(frames).toHaveBeenCalledTimes(1);
    expect(frames.mock.calls[0][0]).toMatchObject({
      blocks: [{ id: 'a', data: { markdown: 'Two' } }],
      removed: [],
      ui: null,
    });
    expect(external).toHaveBeenCalledWith({ action: 'conflict' });
    expect(readOnly).toHaveBeenCalledWith({ reason: 'readOnlyFile', action: 'makeEditable' });
  });
});

describe('ink through the Tauri page service', () => {
  it('sends new strokes with page_add_strokes and tells listeners what undo did to the ink', async () => {
    const opened = envelope([block('b1', 'x')]);
    const { core, calls } = fakeCore([{ ...opened, ink: new Uint8Array([1, 2, 3]), moreInk: true }]);
    const extra = core as unknown as Record<string, unknown>;
    const added = vi.fn(() => Promise.resolve({ seq: 4, orderKeys: {}, canUndo: true, canRedo: false }));
    const records = new Uint8Array([9, 9]);
    extra.pageAddStrokes = added;
    extra.pageReadStrokes = vi.fn(() => Promise.resolve(records));
    extra.pageUndo = vi.fn(() =>
      Promise.resolve({
        seq: 5,
        changes: { pageFields: false, blocksChanged: [], blocksRemoved: [], assetsChanged: [], strokesRemoved: ['s1'] },
        ui: null,
        texts: {},
        blocks: [],
        title: null,
        tags: null,
        view: null,
        assets: [],
        canUndo: false,
        canRedo: true,
        strokes: 0,
        records: new Uint8Array(),
      }),
    );
    const page = await createTauriPageService(core, {} as ImagesClient).open('p1', { viewport: null });
    expect([...page.ink!.records]).toEqual([1, 2, 3]);
    expect(page.ink!.more).toBe(true);
    expect(await page.ink!.readAll()).toBe(records);

    await page.send({ edits: [{ edit: 'removeStrokes', strokes: ['s0'] }], strokes: records });
    expect(added).toHaveBeenCalledWith(
      expect.objectContaining({ clientSeq: 4, edits: [{ edit: 'removeStrokes', strokes: ['s0'] }] }),
      records,
    );
    expect(calls.pageApply).not.toHaveBeenCalled();

    const heard = vi.fn();
    page.ink!.onChange(heard);
    const frame = await page.undo();
    expect(frame?.ink?.removed).toEqual(['s1']);
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ removed: ['s1'] }));
  });
});

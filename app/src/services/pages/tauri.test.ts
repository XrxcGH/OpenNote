// The Tauri page service over a fake core client: history calls, frames from other clients' changes, external
// changes, and read-only notices.
import { describe, expect, it, vi } from 'vitest';
import type { CoreClient, DecodedEnvelope } from '../../core/client';
import type { ImagesClient } from '../../platform/types';
import { clientPrefix, createTauriPageService, readOnlyInfo, toVersionInfo } from './tauri';

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
});

describe('the Tauri page service’s requests', () => {
  it('numbers an edit only when the core takes it, so a refused edit leaves its number for the next', async () => {
    const { core, calls } = fakeCore([envelope([])]);
    calls.pageApply.mockImplementationOnce(() => Promise.reject({ code: 'invalid', message: 'Too long.' }));
    const page = await createTauriPageService(core, images).open('p1', { viewport: null });
    const refused = page.send({ edits: [] });
    const next = page.send({ edits: [] });
    await expect(refused).rejects.toMatchObject({ code: 'invalid' });
    await next;
    await page.send({ edits: [] });
    const seqs = (calls.pageApply.mock.calls as unknown as [{ clientSeq: number }][]).map(([r]) => r.clientSeq);
    expect(seqs).toEqual([4, 4, 5]);
  });

  it('builds asset addresses that WebView2 routes, with each ID kept to one path segment', async () => {
    const { core } = fakeCore([envelope([])]);
    const page = await createTauriPageService(core, images).open('p1', { viewport: null });
    expect(page.assetUrl('01k6asset')).toBe('http://opennote-asset.localhost/p1/01k6asset');
    expect(page.assetUrl('../x?y#z')).toBe('http://opennote-asset.localhost/p1/..%2Fx%3Fy%23z');
  });

  it('keeps edits, undo, and restores in the order they were asked for', async () => {
    const { core, calls } = fakeCore([envelope([])]);
    const order: string[] = [];
    calls.pageApply.mockImplementation(() => {
      order.push('apply');
      return Promise.resolve({ seq: 1, orderKeys: {}, canUndo: true, canRedo: false });
    });
    Object.assign(calls, { pageUndo: vi.fn(() => (order.push('undo'), Promise.resolve(null))) });
    const page = await createTauriPageService(core, images).open('p1', { viewport: null });
    await Promise.all([page.send({ edits: [] }), page.undo(), page.send({ edits: [] })]);
    expect(order).toEqual(['apply', 'undo', 'apply']);
  });

  it('takes the core’s number again after an edit arrives out of order', async () => {
    const reopened = envelope([]);
    reopened.session = { ...reopened.session, clientSeq: 7 };
    const { core, calls } = fakeCore([envelope([]), reopened]);
    calls.pageApply.mockImplementationOnce(() => Promise.reject({ code: 'outOfOrder', message: 'Expected 8.' }));
    const page = await createTauriPageService(core, images).open('p1', { viewport: null });
    await expect(page.send({ edits: [] })).rejects.toMatchObject({ code: 'outOfOrder', resync: true });
    await page.send({ edits: [] });
    expect(calls.pageApply.mock.calls.at(-1)).toMatchObject([{ clientSeq: 8 }]);
  });
});

describe('the Tauri page service’s events', () => {
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

describe('the Tauri page service’s client names', () => {
  const CLIENT_ID = /^[a-z0-9-]{1,32}$/;

  it('gives each window clients of its own, so two windows on one page never share a core session', async () => {
    const main = fakeCore([envelope([])]);
    const popped = fakeCore([envelope([])]);
    const capture = fakeCore([envelope([])]);
    const inMain = await createTauriPageService(main.core, images, clientPrefix('main')).open('p1', { viewport: null });
    const inWindow = await createTauriPageService(popped.core, images, clientPrefix('page-01k6f0000000')).open('p1', {
      viewport: null,
    });
    const inCapture = await createTauriPageService(capture.core, images, clientPrefix('capture')).open('p1', {
      viewport: null,
    });
    expect(inMain.client).toBe('main-1');
    expect(new Set([inMain.client, inWindow.client, inCapture.client]).size).toBe(3);
    expect(popped.calls.pageOpen).toHaveBeenCalledWith('p1', inWindow.client, null);
    for (const name of [inMain.client, inWindow.client, inCapture.client]) expect(name).toMatch(CLIENT_ID);
  });

  it('names a window opened again differently from the last one, and within what the core accepts', () => {
    const names = new Set(Array.from({ length: 50 }, () => clientPrefix('page-01k6f00000000000000000p001')));
    expect(names.size).toBe(50);
    for (const name of names) expect(`${name}-9999`).toMatch(CLIENT_ID);
    expect(clientPrefix('capture', (bytes) => bytes.fill(35))).toBe('wzzzzzzzz');
  });
});

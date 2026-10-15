import { beforeEach, describe, expect, it, vi } from 'vitest';

const extras = { mediaBlocks: vi.fn(), setMediaText: vi.fn() };
const api = { searchTextReady: vi.fn(), searchTextInImage: vi.fn() };
vi.mock('../client', () => ({ maybeSearchClient: () => ({ extras }) }));
vi.mock('../../intel', () => ({ loadApi: async () => api }));
vi.mock('../../page', () => ({ shownMounted: { get: () => null, subscribe: () => () => undefined } }));
vi.mock('../../../app/flags', () => ({ isEnabled: () => true }));

const { MAX_FAILURES, resetIndexer, scan } = await import('./indexer');

function mounted(blocks: { id: string; type: string; asset?: string }[], assetOk: boolean) {
  vi.stubGlobal('fetch', async () => ({ ok: assetOk, blob: async () => new Blob(['x']) }));
  return {
    page: { id: 'p1', assetUrl: (a: string) => `asset://${a}` },
    layer: { blocks: () => blocks.map((b) => ({ id: b.id, type: b.type, data: b.asset ? { asset: b.asset } : {} })) },
  } as never;
}

beforeEach(() => {
  resetIndexer();
  extras.mediaBlocks.mockReset().mockResolvedValue([]);
  extras.setMediaText.mockReset().mockResolvedValue(true);
  api.searchTextReady.mockReset().mockResolvedValue(true);
  api.searchTextInImage.mockReset().mockResolvedValue({ text: 'hello' });
});

describe('the media indexer scan', () => {
  it('reads a new picture on a later pass and then leaves it alone', async () => {
    const page = mounted([{ id: 'a', type: 'image', asset: 'x' }], true);
    await scan(page, () => true);
    await scan(page, () => true);
    expect(extras.setMediaText).toHaveBeenCalledTimes(1);
    expect(extras.setMediaText).toHaveBeenCalledWith('p1', 'a', 'image', 'hello');
  });

  it('does not ask the index when nothing waits', async () => {
    await scan(mounted([{ id: 't', type: 'text' }], true), () => true);
    expect(extras.mediaBlocks).not.toHaveBeenCalled();
  });

  it('gives up on a picture that cannot be read after the cap', async () => {
    const page = mounted([{ id: 'a', type: 'image', asset: 'x' }], false);
    for (let i = 0; i < MAX_FAILURES + 4; i += 1) await scan(page, () => true);
    expect(extras.mediaBlocks).toHaveBeenCalledTimes(MAX_FAILURES);
  });
});

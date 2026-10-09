import { describe, expect, it, vi } from 'vitest';
import type { BlockJson } from '../../services/pages/types';
import type { MountedPage } from './pagesApi';
import { snapshotPage } from './snapshot';

vi.mock('./images/assets', () => ({ assetTable: () => new Map() }));
vi.mock('./blocks/textBlock', () => ({
  liveText: (view: { live?: string } | null) => (view?.live === undefined ? null : { liveMarkdown: () => view.live }),
}));

const text = (id: string, markdown: string): BlockJson =>
  ({ id, type: 'text', order: id, data: { markdown } }) as unknown as BlockJson;

describe('snapshotPage', () => {
  it('carries the text typed since the core last saw it, so slides and export are not empty', () => {
    const blocks = [text('a', ''), text('b', 'stale')];
    const live: Record<string, string> = { a: '## Title\n\n- one\n- two', b: 'typed' };
    const mounted = {
      page: { initial: { blocks: [] } },
      layer: { blocks: () => blocks, view: (id: string) => ({ live: live[id] }) },
      layout: { view: () => ({}) },
    } as unknown as MountedPage;
    const json = snapshotPage(mounted, 'T');
    expect(json.blocks.map((b) => b.data.markdown)).toEqual(['## Title\n\n- one\n- two', 'typed']);
  });
});

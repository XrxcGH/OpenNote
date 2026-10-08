import { describe, expect, it } from 'vitest';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { PageJson } from '../../../services/pages/types';
import { applyEdit, applyLinkEdits } from './applyEdits';

const stamp = '2026-09-30T10:00:00.000Z';

function page(id: string, markdown: Record<string, string>): PageJson {
  return {
    id,
    title: id,
    created: stamp,
    modified: stamp,
    tags: [],
    view: {},
    assets: {},
    blocks: Object.entries(markdown).map(([block, text], at) => ({
      id: block,
      type: 'text',
      order: String(at),
      created: stamp,
      modified: stamp,
      data: { markdown: text },
    })),
  };
}

describe('applying a link edit', () => {
  it('changes links and leaves the same text in code', () => {
    const edit = { old: '[[Leaf]]', new: '[[Foliage]]' };
    expect(applyEdit('A `[[Leaf]]` and [[Leaf]] and [[Leaf#Veins]]', edit)).toBe(
      'A `[[Leaf]]` and [[Foliage]] and [[Leaf#Veins]]',
    );
  });

  it('changes an ID link by its text', () => {
    const edit = { old: '[Leaf](opennote:page/p1)', new: '[Foliage](opennote:page/p1)' };
    expect(applyEdit('See [Leaf](opennote:page/p1).', edit)).toBe('See [Foliage](opennote:page/p1).');
  });
});

describe('applying link edits to pages', () => {
  it('rewrites each page as one batch and skips a page it cannot open', async () => {
    const service = createMemoryPageService([
      { page: page('a', { x: 'See [[Leaf]] here', y: 'No link' }) },
      { page: page('b', { z: '[[Leaf]] and [[Leaf]]' }) },
    ]);
    const done = await applyLinkEdits(service, [
      { page: 'a', block: 'x', old: '[[Leaf]]', new: '[[Foliage]]' },
      { page: 'b', block: 'z', old: '[[Leaf]]', new: '[[Foliage]]' },
      { page: 'missing', block: 'q', old: '[[Leaf]]', new: '[[Foliage]]' },
    ]);
    expect(done).toEqual({ pages: 2, links: 2 });
    const text = (id: string, block: string) => service.held(id)?.blocks.find((b) => b.id === block)?.data.markdown;
    expect(text('a', 'x')).toBe('See [[Foliage]] here');
    expect(text('b', 'z')).toBe('[[Foliage]] and [[Foliage]]');
    expect(service.sent('a')).toHaveLength(1);
  });
});

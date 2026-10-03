import { describe, expect, it } from 'vitest';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { PageJson } from '../../../services/pages/types';
import type { TagPlan } from '../../../services/search/types';
import { addTagToPage, applyTagPlan, normalTag, rewritePageTags, rewriteTags } from './rewrite';

const plan: TagPlan = {
  changes: [
    { from: 'school', to: 'uni', pages: ['a'] },
    { from: 'school/bio', to: 'uni/bio', pages: ['a', 'b'] },
    { from: 'old', to: null, pages: ['b'] },
  ],
  pageCount: 2,
  merges: false,
};

const stamp = '2026-09-30T10:00:00.000Z';

function make(id: string, markdown: string, tags: string[]): PageJson {
  return {
    id,
    title: id,
    created: stamp,
    modified: stamp,
    tags,
    view: {},
    assets: {},
    blocks: [{ id: `${id}1`, type: 'text', order: '0', created: stamp, modified: stamp, data: { markdown } }],
  };
}

describe('tag rewriting', () => {
  it('normalizes like the index', () => {
    expect(normalTag('#School/Café ')).toBe('school/cafe');
    expect(normalTag('a // b')).toBe('a/b');
  });

  it('renames tags and nested tags in text, and takes the hash off a deleted one', () => {
    expect(rewriteTags('Read #School and #school/Bio, then #old stuff #other `#school`', plan)).toBe(
      'Read #uni and #uni/bio, then old stuff #other `#school`',
    );
  });

  it('leaves a heading and a hash that does not start a word', () => {
    expect(rewriteTags('# school\nissue#school and #school2', plan)).toBe('# school\nissue#school and #school2');
  });

  it('renames, merges, and removes a page’s own tags', () => {
    expect(rewritePageTags(['School', 'keep', 'school/bio', 'old'], plan)).toEqual(['uni', 'keep', 'uni/bio']);
    const merge: TagPlan = { changes: [{ from: 'a', to: 'b', pages: ['x'] }], pageCount: 1, merges: true };
    expect(rewritePageTags(['a', 'b'], merge)).toEqual(['b']);
  });

  it('applies a plan to the tags and text of its pages, one batch each', async () => {
    const service = createMemoryPageService([
      { page: make('a', 'About #school today', ['School', 'keep']) },
      { page: make('b', '#old and #school/bio', ['school/bio']) },
    ]);
    const done = await applyTagPlan(service, plan);
    expect(done).toEqual({ pages: 2, tags: 4 });
    expect(service.held('a')?.blocks[0].data.markdown).toBe('About #uni today');
    expect(service.held('a')?.tags).toEqual(['uni', 'keep']);
    expect(service.held('b')?.blocks[0].data.markdown).toBe('old and #uni/bio');
    expect(service.held('b')?.tags).toEqual(['uni/bio']);
    expect(service.sent('a')).toHaveLength(1);
  });

  it('adds a tag to a page once', async () => {
    const service = createMemoryPageService([{ page: make('a', 'text', ['keep']) }]);
    expect(await addTagToPage(service, 'a', '#Biology')).toBe(true);
    expect(await addTagToPage(service, 'a', 'biology')).toBe(false);
    expect(service.held('a')?.tags).toEqual(['keep', 'biology']);
  });
});

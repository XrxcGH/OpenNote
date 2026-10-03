import { describe, expect, it } from 'vitest';
import type { PageJson } from '../pages/types';
import { createMemorySearch } from './memory';
import type { MemorySearch } from './memory';
import { pieces, toStringRanges } from './text';
import type { IndexUpdate } from './types';

function page(id: string, title: string, blocks: Record<string, string>, tags: string[] = []): PageJson {
  const stamp = '2026-09-30T10:00:00.000Z';
  return {
    id,
    title,
    created: stamp,
    modified: stamp,
    tags,
    view: {},
    assets: {},
    blocks: Object.entries(blocks).map(([block, markdown], at) => ({
      id: block,
      type: 'text',
      order: String(at),
      created: stamp,
      modified: stamp,
      data: { markdown },
    })),
  };
}

function setup(pages: PageJson[]): { search: MemorySearch; pages: Map<string, PageJson> } {
  const held = new Map(pages.map((p) => [p.id, p]));
  const search = createMemorySearch({ held: (id) => held.get(id) ?? null });
  void search.sync(
    pages.map((p) => ({ page: p.id, title: p.title })),
    true,
  );
  return { search, pages: held };
}

const sample = () => [
  page('cells', 'Cell biology', {
    a: '# Organelles\n\nMitochondria make energy for the cell.',
    b: 'Café notes and #school/biology',
  }),
  page('plants', 'Plant tour', { c: 'See [[Cell biology]] and [[Cell biology#Organelles]] and [[Nowhere]].' }, []),
  page('exam', 'Exam review', { d: 'Cells divide. #school/exam and #school/biology' }),
];

describe('search', () => {
  it('requires every word, matches the last as a prefix, and ignores case and accents', async () => {
    const { search } = setup(sample());
    expect((await search.search({ text: 'mitochon' })).hits.map((hit) => hit.page)).toEqual(['cells']);
    expect((await search.search({ text: 'mitochondria energy' })).hits).toHaveLength(1);
    expect((await search.search({ text: 'mitochondria zebra' })).hits).toHaveLength(0);
    expect((await search.search({ text: 'CAFE' })).hits.map((hit) => hit.page)).toEqual(['cells']);
  });

  it('reads phrases, a minus sign, OR, and tag: and title: operators', async () => {
    const { search } = setup(sample());
    const pagesOf = async (text: string) => (await search.search({ text })).hits.map((hit) => hit.page).sort();
    expect(await pagesOf('"energy make"')).toEqual([]);
    expect(await pagesOf('"mitochondria make"')).toEqual(['cells']);
    expect(await pagesOf('cells -mitochondria')).toEqual(['exam']);
    expect(await pagesOf('mitochondria OR divide')).toEqual(['cells', 'exam']);
    expect(await pagesOf('tag:school/exam')).toEqual(['exam']);
    expect(await pagesOf('tag:school')).toEqual(['cells', 'exam']);
    expect(await pagesOf('title:plant')).toEqual(['plants']);
  });

  it('puts a title match first and reports highlights as UTF-8 byte ranges', async () => {
    const { search } = setup([page('a', 'Plant tour', { x: 'cell wall' }), page('b', 'Wall of cells', { y: 'cell' })]);
    const { hits } = await search.search({ text: 'cell' });
    expect(hits[0].page).toBe('b');
    const snippet = hits.find((hit) => hit.page === 'a')!.snippet!;
    expect(
      pieces(snippet.text, snippet.highlights)
        .filter((p) => p.match)
        .map((p) => p.text),
    ).toEqual(['cell']);
    // "é" takes two bytes, so a range after it is not at the string offset.
    const accented = setup([page('c', 'Notes', { z: 'é cell' })]);
    const [hit] = (await accented.search.search({ text: 'cell' })).hits;
    expect(hit.snippet!.highlights).toEqual([{ start: 3, end: 7 }]);
    expect(toStringRanges(hit.snippet!.text, hit.snippet!.highlights)).toEqual([{ start: 2, end: 6 }]);
  });

  it('searches with a regular expression and says when it is not valid', async () => {
    const { search } = setup(sample());
    expect((await search.search({ text: 'mito\\w+', regex: true })).hits.map((hit) => hit.page)).toEqual(['cells']);
    const bad = await search.search({ text: '(unclosed', regex: true });
    expect(bad.hits).toEqual([]);
    expect(bad.patternError).toMatch(/not valid/);
  });

  it('limits titles only and by tag filter', async () => {
    const { search } = setup(sample());
    expect((await search.search({ text: 'cell', filters: { titleOnly: true } })).hits.map((hit) => hit.page)).toEqual([
      'cells',
    ]);
    expect((await search.search({ text: '', filters: { tags: ['school/exam'] } })).hits.map((hit) => hit.page)).toEqual(
      ['exam'],
    );
  });
});

describe('the quick switcher', () => {
  it('lists recent pages first for an empty query, without the open page', async () => {
    const { search } = setup(sample());
    const answer = await search.switcher({ query: '', recent: ['exam', 'plants'], current: 'exam' });
    expect(answer.hits[0].page).toBe('plants');
    expect(answer.hits.some((hit) => hit.page === 'exam')).toBe(false);
  });

  it('ranks an exact title above a prefix above a word, and offers the title for a page that does not exist', async () => {
    const { search } = setup([page('a', 'Cell', {}), page('b', 'Cell biology', {}), page('c', 'The cell', {})]);
    expect((await search.switcher({ query: 'cell' })).hits.map((hit) => hit.page)).toEqual(['a', 'b', 'c']);
    expect((await search.switcher({ query: 'zebrafish' })).create).toBe('zebrafish');
  });
});

describe('links', () => {
  it('resolves a title, an ambiguous one, a renamed one, and a missing one', async () => {
    const { search } = setup([
      page('a', 'Alpha', {}),
      page('b1', 'Twin', {}),
      page('b2', 'Twin', {}),
      page('c', 'Gamma', {}),
    ]);
    const [resolved, ambiguous, missing] = await search.resolve([
      { title: 'alpha' },
      { title: 'Twin' },
      { title: 'Nope' },
    ]);
    expect([resolved.status, ambiguous.status, missing.status]).toEqual(['resolved', 'ambiguous', 'broken']);
    expect(ambiguous.targets).toHaveLength(2);
    await search.sync([{ page: 'c', title: 'Delta' }], false);
    const [renamed] = await search.resolve([{ title: 'Gamma' }]);
    expect(renamed.status).toBe('renamed');
    expect(renamed.targets[0].page).toBe('c');
  });

  it('lists the pages that link to a page, with the heading they name', async () => {
    const { search } = setup(sample());
    const links = await search.backlinks('cells');
    expect(links.map((link) => link.link)).toEqual(['[[Cell biology]]', '[[Cell biology#Organelles]]']);
    expect(links[0]).toMatchObject({ source: 'plants', sourceTitle: 'Plant tour', stale: false });
    expect(await search.backlinks('plants')).toEqual([]);
  });

  it('flags a missing heading and previews the lines under a heading', async () => {
    const { search } = setup(sample());
    const [ok, missing] = await search.resolve([
      { title: 'Cell biology', heading: 'Organelles' },
      { title: 'Cell biology', heading: 'Zebra' },
    ]);
    expect([ok.headingMissing, missing.headingMissing]).toEqual([false, true]);
    const card = await search.linkPreview({ title: 'Cell biology', fragment: 'Organelles' });
    expect(card).toMatchObject({ title: 'Cell biology', heading: 'Organelles', headingMissing: false });
    expect(card?.text.split('\n')[0]).toBe('Mitochondria make energy for the cell.');
    expect(card?.text).not.toContain('Nowhere');
    expect((await search.linkPreview({ title: 'Cell biology', fragment: 'Zebra' }))?.headingMissing).toBe(true);
    expect(await search.linkPreview({ title: 'Nowhere' })).toBeNull();
  });

  it('suggests pages by title and lists headings', async () => {
    const { search } = setup(sample());
    expect((await search.suggestPages('cel')).map((suggestion) => suggestion.page)).toEqual(['cells']);
    expect((await search.headings('cells')).map((heading) => [heading.level, heading.text])).toEqual([
      [1, 'Organelles'],
    ]);
  });
});

describe('renaming a linked page', () => {
  it('plans a rename only when the title settles, and not when another page still has the old title', async () => {
    const { search } = setup(sample());
    const heard: IndexUpdate[] = [];
    search.onUpdate((update) => heard.push(update));
    await search.sync([{ page: 'cells', title: 'Cell' }], false);
    await search.sync([{ page: 'cells', title: 'Cell biology 101' }], false);
    expect(heard).toEqual([]);
    await search.titleSettled('cells');
    const plan = heard[0].renames![0];
    expect(plan).toMatchObject({
      page: 'cells',
      oldTitle: 'Cell biology',
      newTitle: 'Cell biology 101',
      otherPages: ['plants'],
    });
    expect(plan.edits.map((edit) => edit.new)).toEqual(['[[Cell biology 101]]', '[[Cell biology 101#Organelles]]']);
    // A second settle has nothing to do.
    await search.titleSettled('cells');
    expect(heard).toHaveLength(1);
  });

  it('reads the Markdown the editor stores, with brackets escaped, and keeps that spelling in a rename', async () => {
    const { search } = setup([
      page('a', 'Alpha', { x: 'Text' }),
      page('b', 'Reader', { y: 'See \\[\\[Alpha\\]\\] and \\#alpha' }),
    ]);
    expect((await search.backlinks('a')).map((link) => link.link)).toEqual(['\\[\\[Alpha\\]\\]']);
    expect((await search.search({ text: 'see alpha' })).hits.map((hit) => hit.page)).toEqual(['b']);
    const heard: IndexUpdate[] = [];
    search.onUpdate((update) => heard.push(update));
    await search.sync([{ page: 'a', title: 'Beta' }], false);
    await search.titleSettled('a');
    expect(heard[0].renames![0].edits.map((edit) => edit.new)).toEqual(['\\[\\[Beta\\]\\]']);
  });

  it('keeps links to a title another page still has', async () => {
    const { search } = setup([
      page('a', 'Shared', {}),
      page('b', 'Shared', {}),
      page('c', 'Reader', { x: '[[Shared]]' }),
    ]);
    const heard: IndexUpdate[] = [];
    search.onUpdate((update) => heard.push(update));
    await search.sync([{ page: 'a', title: 'Unshared' }], false);
    await search.titleSettled('a');
    expect(heard[0].renames![0].edits).toEqual([]);
  });

  it('lists links that still use an earlier title, as edits', async () => {
    const { search } = setup(sample());
    await search.sync([{ page: 'cells', title: 'Biology of cells' }], false);
    const edits = await search.repairEdits('cells');
    expect(edits.map((edit) => edit.new)).toEqual(['[[Biology of cells]]', '[[Biology of cells#Organelles]]']);
  });
});

describe('mentions', () => {
  it('finds a title said without a link, never inside a link or code', async () => {
    const { search } = setup([
      page('t', 'Mitosis', {}),
      page('s', 'Notes', {
        a: 'Mitosis is fast, see [[Mitosis]] and `mitosis` and https://x.org/mitosis',
        b: 'No mention here',
      }),
    ]);
    const mentions = await search.unlinkedMentions('t');
    expect(mentions).toHaveLength(1);
    expect(mentions[0]).toMatchObject({ source: 's', count: 1 });
    expect(mentions[0].blocks.map((block) => block.block)).toEqual(['a']);
    const places = await search.findMentions('Mitosis is fast, see [[Mitosis]] and `mitosis`', 'Mitosis');
    expect(places.map((place) => place.text)).toEqual(['Mitosis']);
  });

  it('links mentions as ID links and leaves the rest', async () => {
    const { search } = setup([page('t', 'Mitosis', {})]);
    const result = await search.linkMentions('mitosis here, and Mitosis again', 'Mitosis', 't');
    expect(result).toEqual({
      markdown: '[mitosis](opennote:page/t) here, and [Mitosis](opennote:page/t) again',
      count: 2,
    });
    expect((await search.linkMentions('mitosis here, and Mitosis again', 'Mitosis', 't', [1]))?.markdown).toBe(
      'mitosis here, and [Mitosis](opennote:page/t) again',
    );
    expect(await search.linkMentions('nothing', 'Mitosis', 't')).toBeNull();
  });
});

describe('tags', () => {
  it('builds the tag tree with nested counts', async () => {
    const { search } = setup(sample());
    expect(await search.tagTree()).toEqual([
      { tag: 'school', pages: 2, ownPages: 0 },
      { tag: 'school/biology', pages: 2, ownPages: 2 },
      { tag: 'school/exam', pages: 1, ownPages: 1 },
    ]);
  });

  it('plans a rename with nested tags, a merge, and a delete', async () => {
    const { search } = setup(sample());
    const rename = await search.planTagRename('school', 'uni');
    expect(rename.changes.map((change) => [change.from, change.to])).toEqual([
      ['school/biology', 'uni/biology'],
      ['school/exam', 'uni/exam'],
    ]);
    expect(rename).toMatchObject({ pageCount: 2, merges: false });
    const merge = await search.planTagRename('school/exam', 'school/biology');
    expect(merge.merges).toBe(true);
    const removal = await search.planTagDelete('school/exam');
    expect(removal.changes).toEqual([{ from: 'school/exam', to: null, pages: ['exam'] }]);
    expect((await search.planTagRename('school', 'school')).changes).toEqual([]);
  });
});

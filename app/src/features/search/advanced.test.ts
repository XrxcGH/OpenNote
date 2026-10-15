import { describe, expect, it } from 'vitest';
import type { NotesService } from '../../services/notes';
import type { SearchHit } from '../../services/search/types';
import { isArchived, matchingHeading, withoutArchived } from './advanced';

const snippet = (text: string, block = 'b1') => ({ block, kind: 'text' as const, text, highlights: [] });

describe('the heading a match is in', () => {
  const headings = [
    { block: 'b1', level: 2, text: 'Nucleus' },
    { block: 'b2', level: 1, text: 'Cell wall' },
  ];
  it('names a heading of the same block that the snippet shows', () => {
    expect(matchingHeading(headings, snippet('The  nucleus holds DNA'))).toEqual(headings[0]);
    expect(matchingHeading(headings, snippet('Cell wall', 'b2'))).toEqual(headings[1]);
  });
  it('names none when the match is body text or there is no snippet', () => {
    expect(matchingHeading(headings, snippet('Mitochondria make energy'))).toBeNull();
    expect(matchingHeading(headings, snippet('Nucleus', 'b2'))).toBeNull();
    expect(matchingHeading(headings, null)).toBeNull();
  });
});

describe('archived pages in results', () => {
  // A notebook n holds a section s (archived when asked) that holds pages p1 and p2, and a plain section t with p3.
  function library(archivedSection: boolean) {
    const nodes: Record<string, { id: string; parentId: string | null; archived?: boolean }> = {
      n: { id: 'n', parentId: null },
      s: { id: 's', parentId: 'n', ...(archivedSection ? { archived: true } : {}) },
      t: { id: 't', parentId: 'n' },
      p1: { id: 'p1', parentId: 's' },
      p2: { id: 'p2', parentId: 's', archived: true },
      p3: { id: 'p3', parentId: 't' },
    };
    return { get: async (id: string) => nodes[id] ?? null } as unknown as NotesService;
  }
  const hit = (page: string): SearchHit =>
    ({ page, title: page, titleHighlights: [], modified: '', score: 1, snippet: null }) as SearchHit;

  it('knows a page is archived when it, or the section holding it, is', async () => {
    expect(await isArchived(library(false), 'p1')).toBe(false);
    expect(await isArchived(library(false), 'p2')).toBe(true);
    expect(await isArchived(library(true), 'p1')).toBe(true);
    expect(await isArchived(library(true), 'p3')).toBe(false);
    expect(await isArchived(library(true), 'gone')).toBe(false);
  });

  it('leaves archived hits out unless asked to include them', async () => {
    const hits = [hit('p1'), hit('p2'), hit('p3')];
    expect((await withoutArchived(library(false), hits, false)).map((one) => one.page)).toEqual(['p1', 'p3']);
    expect((await withoutArchived(library(true), hits, false)).map((one) => one.page)).toEqual(['p3']);
    expect((await withoutArchived(library(true), hits, true)).map((one) => one.page)).toEqual(['p1', 'p2', 'p3']);
  });
});

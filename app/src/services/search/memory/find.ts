// Full-text search and the quick switcher over the in-memory index.
import { fold } from '../text';
import type {
  SearchHit,
  SearchRequest,
  SearchResponse,
  Snippet,
  SwitchHit,
  SwitchRequest,
  SwitchResponse,
} from '../types';
import { allDocs } from './docs';
import type { Block, Doc, Index } from './docs';
import { excerpt, matches, matchRanges, normalTag, parseQuery, termOf, toBytes } from './terms';
import type { ParsedQuery, Span, Term } from './terms';

/** A page that matched: how well, and where the words are in any text. */
interface Match {
  score: number;
  ranges(text: string): Span[];
}

type Finder = (doc: Doc, body: Block[]) => Match | null;

const MAX_LIMIT = 100;
const MAX_TAG_FILTERS = 20;

function hasTag(doc: Doc, wanted: string): boolean {
  return doc.tags.some((tag) => {
    const folded = normalTag(tag);
    return folded === wanted || folded.startsWith(`${wanted}/`);
  });
}

function regexFinder(regex: RegExp): Finder {
  const rangesIn = (text: string): Span[] =>
    [...text.matchAll(regex)].filter((m) => m[0] !== '').map((m) => ({ start: m.index, end: m.index + m[0].length }));
  return (doc, body) => {
    const inTitle = rangesIn(doc.title).length > 0;
    const inBody = body.some((block) => rangesIn(block.plain).length > 0);
    return inTitle || inBody ? { score: inTitle ? 100 : 10, ranges: rangesIn } : null;
  };
}

/** Points for a title match: the whole title, the start of it, or a word inside it. */
function titlePoints(title: string, term: Term): number {
  const ranges = matchRanges(title, term);
  if (!ranges.length) return 0;
  if (ranges[0].start === 0) return ranges[0].end === title.length ? 100 : 60;
  return 40;
}

function termScore(doc: Doc, body: Block[], terms: Term[]): number {
  let score = 0;
  for (const term of terms) {
    score += titlePoints(doc.title, term);
    score += Math.min(body.filter((block) => matches(block.plain, term)).length, 5) * 3;
  }
  return score;
}

function termFinder(parsed: ParsedQuery): Finder {
  return (doc, body) => {
    const textOf = (term: Term) => matches(doc.title, term) || body.some((block) => matches(block.plain, term));
    if (parsed.excluded.some(textOf)) return null;
    if (!parsed.titleTerms.every((term) => matches(doc.title, term))) return null;
    const group = parsed.alternatives.length ? parsed.alternatives.find((terms) => terms.every(textOf)) : [];
    if (!group) return null;
    const terms = [...group, ...parsed.titleTerms];
    return { score: termScore(doc, body, terms), ranges: (text) => terms.flatMap((term) => matchRanges(text, term)) };
  };
}

/** The block with the most matches, cut to a few words, or the start of the page when nothing matched. */
function snippetFor(doc: Doc, match: Match): Snippet | null {
  let best: { block: Block; ranges: Span[] } | null = null;
  for (const block of doc.blocks) {
    const ranges = match.ranges(block.plain);
    if (ranges.length > (best?.ranges.length ?? 0)) best = { block, ranges };
  }
  const chosen = best ?? (doc.blocks[0] ? { block: doc.blocks[0], ranges: [] } : null);
  if (!chosen) return null;
  const { text, shift } = excerpt(chosen.block.plain, chosen.ranges);
  const lead = text.startsWith('…') ? 1 : 0;
  const inside = chosen.ranges
    .map(({ start, end }) => ({ start: start - shift, end: end - shift }))
    .filter(({ start, end }) => start >= lead && end <= text.length)
    .sort((a, b) => a.start - b.start);
  return { block: chosen.block.id, kind: chosen.block.kind, text, highlights: toBytes(text, inside) };
}

function hitFor(doc: Doc, find: Finder, titleOnly: boolean): SearchHit | null {
  const match = find(doc, titleOnly ? [] : doc.blocks);
  if (!match) return null;
  const titleRanges = match.ranges(doc.title).sort((a, b) => a.start - b.start);
  return {
    page: doc.page,
    title: doc.title,
    titleHighlights: toBytes(doc.title, titleRanges),
    modified: doc.modified,
    score: match.score,
    snippet: titleOnly ? null : snippetFor(doc, match),
  };
}

function compile(request: SearchRequest): Finder | null {
  if (!request.regex) return termFinder(parseQuery(request.text));
  try {
    return regexFinder(new RegExp(request.text, 'giu'));
  } catch {
    return null;
  }
}

export function search(index: Index, request: SearchRequest): SearchResponse {
  const find = compile(request);
  if (!find) {
    return { hits: [], complete: true, notes: [], patternError: 'That regular expression is not valid.' };
  }
  const filters = request.filters ?? {};
  const typed = request.regex ? [] : parseQuery(request.text).tags;
  const tags = [...typed, ...(filters.tags ?? []).map(normalTag)].slice(0, MAX_TAG_FILTERS);
  const hits = allDocs(index)
    .filter((doc) => tags.every((tag) => hasTag(doc, tag)))
    .map((doc) => hitFor(doc, find, filters.titleOnly === true))
    .filter((hit): hit is SearchHit => hit !== null)
    .sort((a, b) => b.score - a.score || b.modified.localeCompare(a.modified) || a.title.localeCompare(b.title));
  const offset = request.offset ?? 0;
  const limit = Math.min(request.limit ?? 20, MAX_LIMIT);
  return { hits: hits.slice(offset, offset + limit), complete: true, notes: [] };
}

function switchHit(doc: Doc, query: string, request: SwitchRequest): SwitchHit | null {
  const recency = (request.recent ?? []).indexOf(doc.page);
  const base = {
    page: doc.page,
    title: doc.title,
    recent: recency === -1 ? null : recency,
    isCurrent: doc.page === request.current,
  };
  if (query === '') {
    if (doc.page === request.current) return null;
    return { ...base, kind: null, score: recency === -1 ? 0 : 1000 - recency, highlights: [] };
  }
  const term = termOf(query, true);
  const ranges = term ? matchRanges(doc.title, term) : [];
  if (!ranges.length) return null;
  const exact = fold(doc.title).trim() === fold(query).trim();
  const atStart = ranges[0].start === 0;
  const kind = exact ? 'exact' : atStart ? 'prefix' : 'word';
  const recent = recency === -1 ? 0 : 10 - Math.min(recency, 9);
  const score = (exact ? 300 : atStart ? 200 : 100) + recent;
  return { ...base, kind, score, highlights: toBytes(doc.title, ranges) };
}

export function switcher(index: Index, request: SwitchRequest): SwitchResponse {
  const query = request.query.trim();
  const hits = allDocs(index)
    .map((doc) => switchHit(doc, query, request))
    .filter((hit): hit is SwitchHit => hit !== null)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, request.limit || 20);
  return { hits, create: query !== '' && hits.length === 0 ? query.slice(0, 200) : null };
}

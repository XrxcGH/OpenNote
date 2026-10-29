// [[Page links]] over the in-memory index: what a title names, the pages that link to a page, the pages that say a
// title without a link, the edits a rename plans, and the first lines a link previews.
import { fold, linkFor, parseLinks, plainText, toByteRange } from '../text';
import type { TitleLink } from '../text';
import type {
  Backlink,
  LinkEdit,
  LinkPreview,
  Mention,
  PageId,
  RenamePlan,
  Resolution,
  UnlinkedMention,
} from '../types';
import { allDocs, headingsOf, newestFirst } from './docs';
import type { Doc, Entry, Index } from './docs';
import { excerpt, wordsOf } from './terms';

const WORD = /[\p{L}\p{N}]+/gu;
const PREVIEW_LINES = 8;
const PREVIEW_CHARS = 400;
const MIN_MENTION_TITLE = 3;
const MENTION_CONTEXT = 40;

const sameTitle = (a: string, b: string) => fold(a).trim() === fold(b).trim();

/** The pages a title names now, or, failing that, the pages that used to have it. */
export function resolveTitle(
  index: Index,
  title: string,
  heading: string | null | undefined,
  from?: PageId,
  all: Doc[] = allDocs(index),
): Resolution {
  const current = all.filter((doc) => sameTitle(doc.title, title));
  const former = all.filter((doc) => {
    const entry = index.tree.get(doc.page);
    return entry !== undefined && sameTitle(entry.settled, title) && !sameTitle(entry.title, title);
  });
  const found = current.length ? current : former;
  const sorted = [...found].sort(
    (a, b) => Number(b.page === from) - Number(a.page === from) || b.modified.localeCompare(a.modified),
  );
  let status: Resolution['status'] = 'broken';
  if (current.length === 1) status = 'resolved';
  else if (current.length > 1) status = 'ambiguous';
  else if (former.length) status = 'renamed';
  const missing =
    !!heading &&
    sorted.length > 0 &&
    sorted.every((doc) => !headingsOf(doc).some((h) => fold(h.text) === fold(heading)));
  return {
    status,
    targets: sorted.map((doc) => ({ page: doc.page, title: doc.title, block: null })),
    headingMissing: missing,
  };
}

function backlinksFrom(index: Index, all: Doc[], doc: Doc, page: PageId): Backlink[] {
  const out: Backlink[] = [];
  for (const block of doc.blocks) {
    for (const link of parseLinks(block.markdown)) {
      const resolved = resolveTitle(index, link.title, link.heading, doc.page, all);
      if (!resolved.targets.some((target) => target.page === page)) continue;
      const at = block.plain.toLowerCase().indexOf(fold(link.title));
      const found = at === -1 ? [] : [{ start: at, end: at + link.title.length }];
      out.push({
        source: doc.page,
        sourceTitle: doc.title,
        block: block.id,
        link: link.raw,
        fragment: link.heading,
        context: { block: block.id, kind: block.kind, text: excerpt(block.plain, found).text, highlights: [] },
        stale: resolved.status === 'renamed',
      });
    }
  }
  return out;
}

/** The links to a page from the others, newest page first. */
export function backlinks(index: Index, page: PageId): Backlink[] {
  const all = allDocs(index);
  if (!all.some((doc) => doc.page === page)) return [];
  return newestFirst(all)
    .filter((doc) => doc.page !== page)
    .flatMap((doc) => backlinksFrom(index, all, doc, page));
}

type Found = Mention & { start: number; end: number };

/** Spans of Markdown where a title is not a mention: code, web addresses, and the links already there. */
function protectedSpans(markdown: string): { start: number; end: number }[] {
  const spans = markdown.matchAll(/`[^`\n]*`|https?:\/\/\S+|\[[^\]\n]*\]\([^)\n]*\)/g);
  return [...spans].map((span) => ({ start: span.index, end: span.index + span[0].length }));
}

function mentionAt(markdown: string, start: number, end: number): Found {
  const lineStart = markdown.lastIndexOf('\n', start - 1) + 1;
  const lineEnd = markdown.indexOf('\n', end);
  return {
    range: toByteRange(markdown, start, end),
    text: markdown.slice(start, end),
    before: markdown.slice(Math.max(lineStart, start - MENTION_CONTEXT), start),
    after: markdown.slice(end, Math.min(lineEnd === -1 ? markdown.length : lineEnd, end + MENTION_CONTEXT)),
    start,
    end,
  };
}

/** The exact places in a Markdown block where `title` is said without a link. */
export function mentionsIn(markdown: string, title: string): Found[] {
  if ([...title.trim()].length < MIN_MENTION_TITLE) return [];
  const words = [...fold(title.trim()).matchAll(WORD)].map((m) => m[0]);
  if (!words.length) return [];
  const blocked = [...parseLinks(markdown), ...protectedSpans(markdown)];
  const found = wordsOf(markdown);
  const out: Found[] = [];
  for (let at = 0; at + words.length <= found.length; at += 1) {
    if (!words.every((word, offset) => found[at + offset].folded === word)) continue;
    const start = found[at].start;
    const end = found[at + words.length - 1].end;
    const overlaps = blocked.some((span) => start < span.end && span.start < end);
    if (overlaps || markdown[start - 1] === '#' || /[[\]\\<>]/.test(markdown.slice(start, end))) continue;
    out.push(mentionAt(markdown, start, end));
  }
  return out;
}

export function unlinkedMentions(index: Index, page: PageId, limit: number): UnlinkedMention[] {
  const all = allDocs(index);
  const target = all.find((doc) => doc.page === page);
  if (!target) return [];
  const out: UnlinkedMention[] = [];
  for (const doc of newestFirst(all).filter((candidate) => candidate.page !== page)) {
    const blocks = doc.blocks
      .map((block) => ({ block, count: mentionsIn(block.markdown, target.title).length }))
      .filter(({ count }) => count > 0)
      .map(({ block, count }) => ({
        block: block.id,
        count,
        context: { block: block.id, kind: block.kind, text: excerpt(block.plain, []).text, highlights: [] },
      }));
    if (!blocks.length) continue;
    out.push({
      source: doc.page,
      sourceTitle: doc.title,
      blocks,
      count: blocks.reduce((sum, block) => sum + block.count, 0),
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Turns the chosen mentions into ID links. Returns null when there is nothing to link. */
export function linkMentions(
  markdown: string,
  title: string,
  target: PageId,
  which?: number[],
): { markdown: string; count: number } | null {
  const found = mentionsIn(markdown, title).filter((_mention, at) => !which || which.includes(at));
  if (!found.length) return null;
  let out = markdown;
  for (const mention of [...found].reverse()) {
    out = `${out.slice(0, mention.start)}[${mention.text}](opennote:page/${target})${out.slice(mention.end)}`;
  }
  return { markdown: out, count: found.length };
}

/** The edits that bring every link that names `old` up to the page's title now. */
function editsToTitle(all: Doc[], old: string, entry: Entry): LinkEdit[] {
  const edits: LinkEdit[] = [];
  for (const doc of all) {
    for (const block of doc.blocks) {
      for (const link of parseLinks(block.markdown).filter((candidate) => sameTitle(candidate.title, old))) {
        edits.push(editFor(doc.page, block.id, link, entry.title));
      }
    }
  }
  return edits.filter(
    (edit, at) => edits.findIndex((e) => e.page === edit.page && e.block === edit.block && e.old === edit.old) === at,
  );
}

function editFor(page: PageId, block: string, link: TitleLink, title: string): LinkEdit {
  return { page, block, old: link.raw, new: linkFor(title, link.heading, link.raw) };
}

/** The links to follow a page whose title settled on something new, or null when it did not change. */
export function renamePlan(index: Index, page: PageId, entry: Entry): RenamePlan | null {
  if (fold(entry.title) === fold(entry.settled)) return null;
  const all = allDocs(index);
  const stillUsed = all.some((doc) => doc.page !== page && sameTitle(doc.title, entry.settled));
  const edits = stillUsed ? [] : editsToTitle(all, entry.settled, entry);
  return {
    page,
    oldTitle: entry.settled,
    newTitle: entry.title,
    edits,
    otherPages: [...new Set(edits.map((edit) => edit.page).filter((other) => other !== page))],
  };
}

/** The edits for links that still use an earlier title of the page. */
export function repairEdits(index: Index, page: PageId): LinkEdit[] {
  const entry = index.tree.get(page);
  if (!entry) return [];
  const all = allDocs(index);
  const changed = !sameTitle(entry.settled, entry.title);
  if (!changed || all.some((doc) => sameTitle(doc.title, entry.settled))) return [];
  return editsToTitle(all, entry.settled, entry);
}

interface Line {
  block: string;
  line: string;
}

/** Where the lines under a heading start, and the heading's text, or that the page has no such heading. */
function section(
  lines: Line[],
  fragment: string | undefined,
): { start: number; heading: string | null; missing: boolean } {
  if (!fragment) return { start: 0, heading: null, missing: false };
  const at = lines.findIndex(({ line }) => {
    const match = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    return match !== null && fold(plainText(match[1])) === fold(fragment);
  });
  if (at === -1) return { start: 0, heading: null, missing: true };
  return { start: at + 1, heading: plainText(lines[at].line.replace(/^\s{0,3}#{1,6}\s+/, '')), missing: false };
}

function previewText(lines: Line[], start: number, level: number): string {
  const shown: string[] = [];
  let used = 0;
  for (let at = start; at < lines.length; at += 1) {
    const text = plainText(lines[at].line);
    const own = /^\s{0,3}(#{1,6})\s/.exec(lines[at].line);
    if (level > 0 && own && own[1].length <= level) break;
    if (text === '') continue;
    if (shown.length >= PREVIEW_LINES || used + text.length > PREVIEW_CHARS) return `${shown.join('\n')}…`;
    shown.push(text);
    used += text.length;
  }
  return shown.join('\n');
}

/** The first lines of a page, or the lines under the heading a link names. */
export function preview(
  index: Index,
  request: { page?: PageId; title?: string; fragment?: string; from?: PageId },
): LinkPreview | null {
  const all = allDocs(index);
  const named =
    request.page ?? resolveTitle(index, request.title ?? '', request.fragment, request.from, all).targets[0]?.page;
  const target = all.find((doc) => doc.page === named);
  if (!target) return null;
  const lines = target.blocks.flatMap((block) => block.markdown.split('\n').map((line) => ({ block: block.id, line })));
  const { start, heading, missing } = section(lines, request.fragment);
  const level = heading ? /^\s{0,3}(#{1,6})/.exec(lines[start - 1].line)![1].length : 0;
  return {
    page: target.page,
    title: target.title,
    heading,
    block: lines[start]?.block ?? null,
    text: previewText(lines, start, level),
    headingMissing: missing,
  };
}

// What the in-memory index knows of a page: the tree's title and the Markdown the page service holds, read fresh on
// each call. A page the person has not opened has no blocks, only a title.
import type { PageJson } from '../../pages/types';
import { plainText } from '../text';
import type { BlockKind, HeadingRef, PageId } from '../types';

/** What the in-memory index reads pages from: the page service's `held`. */
export interface MemoryPageSource {
  held(page: PageId): PageJson | null;
}

export interface Entry {
  title: string;
  /** The title the links last followed. */
  settled: string;
}

export interface Block {
  id: string;
  kind: BlockKind;
  markdown: string;
  plain: string;
}

export interface Doc {
  page: PageId;
  title: string;
  tags: string[];
  modified: string;
  blocks: Block[];
}

/** The tree's pages and where their text comes from. */
export interface Index {
  tree: Map<PageId, Entry>;
  source: MemoryPageSource;
}

function blockKind(type: string): BlockKind {
  return type === 'text' || type === 'table' || type === 'image' || type === 'file' || type === 'ink' ? type : 'other';
}

/** The inline `#tags` of a Markdown block: a hash at the start of a word, with a letter in the word, outside code. */
function inlineTags(markdown: string): string[] {
  const out: string[] = [];
  markdown.split(/(`+[^`]*`+)/).forEach((part, at) => {
    if (at % 2 === 1) return;
    for (const match of part.matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
      if (/\p{L}/u.test(match[1])) out.push(match[1]);
    }
  });
  return out;
}

function docOf(page: PageId, entry: Entry, held: PageJson | null): Doc {
  const blocks = (held?.blocks ?? [])
    .map((block) => {
      const markdown = typeof block.data.markdown === 'string' ? block.data.markdown : '';
      return { id: block.id, kind: blockKind(block.type), markdown, plain: plainText(markdown) };
    })
    .filter((block) => block.markdown !== '');
  const inline = blocks.flatMap((block) => (block.kind === 'text' ? inlineTags(block.markdown) : []));
  return {
    page,
    title: entry.title,
    tags: [...new Set([...(held?.tags ?? []), ...inline])],
    modified: held?.modified ?? new Date(0).toISOString(),
    blocks,
  };
}

/** Every page of the tree as the index sees it now. */
export function allDocs(index: Index): Doc[] {
  return [...index.tree].map(([page, entry]) => docOf(page, entry, index.source.held(page)));
}

/** The headings of a page, in reading order. */
export function headingsOf(doc: Doc): HeadingRef[] {
  return doc.blocks.flatMap((block) =>
    block.markdown
      .split('\n')
      .map((line) => /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => ({ block: block.id, level: match[1].length, text: plainText(match[2]) })),
  );
}

/** Newest change first. */
export function newestFirst(docs: readonly Doc[]): Doc[] {
  return [...docs].sort((a, b) => b.modified.localeCompare(a.modified));
}

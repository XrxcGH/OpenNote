// Extract, merge, and split (FEATURES.md, Extract and merge pages): the logic on blocks and Markdown. Splitting a
// page at its headings gives one section per heading of the page's least level; merging joins pages with each
// title as a heading. Neither changes the pages it reads: they make new pages, so nothing is lost.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { newId } from '../../../editor/ids';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../../../editor/markdown';
import type { BlockJson, NewBlock } from '../../../services/pages/types';

export interface Section {
  title: string;
  blocks: NewBlock[];
}

export interface SplitResult {
  /** The least heading level, where the page is cut. */
  level: number;
  /** What comes before the first heading of that level. */
  intro: NewBlock[];
  sections: Section[];
  /** Blocks that can't move to another page (images and ink), left on the original. */
  skipped: number;
}

const markdownOf = (block: BlockJson) => (typeof block.data.markdown === 'string' ? block.data.markdown : '');

function textBlock(nodes: readonly PMNode[], doc: PMNode): NewBlock | null {
  if (nodes.length === 0) return null;
  const markdown = serializeTextBlock(doc.type.create(null, Fragment.from(nodes)), createMarkdownCache());
  return markdown.trim() === '' ? null : { id: newId(), type: 'text', data: { markdown } };
}

const copyTable = (block: BlockJson): NewBlock => ({
  id: newId(),
  type: 'table',
  data: JSON.parse(JSON.stringify(block.data)) as Record<string, unknown>,
});

/** The least level of the headings that start a top-level node, or null when there are none. */
function leastLevel(blocks: readonly BlockJson[]): number | null {
  let least: number | null = null;
  for (const block of blocks) {
    if (block.type !== 'text') continue;
    parseTextBlock(markdownOf(block)).forEach((node) => {
      if (node.type.name === 'heading') least = Math.min(least ?? 6, Number(node.attrs.level));
    });
  }
  return least;
}

/** Cuts a page at the headings of its least level. Null when the page has no headings. */
export function splitAtHeadings(blocks: readonly BlockJson[]): SplitResult | null {
  const level = leastLevel(blocks);
  if (level === null) return null;
  const intro: NewBlock[] = [];
  const sections: Section[] = [];
  let skipped = 0;
  const into = () => sections.at(-1)?.blocks ?? intro;
  for (const block of blocks) {
    if (block.type === 'table') {
      into().push(copyTable(block));
      continue;
    }
    if (block.type !== 'text') {
      skipped += 1;
      continue;
    }
    const doc = parseTextBlock(markdownOf(block));
    let pending: PMNode[] = [];
    const flush = () => {
      const made = textBlock(pending, doc);
      if (made) into().push(made);
      pending = [];
    };
    doc.forEach((node) => {
      if (node.type.name === 'heading' && Number(node.attrs.level) === level) {
        flush();
        sections.push({ title: node.textContent.trim(), blocks: [] });
      } else {
        pending.push(node);
      }
    });
    flush();
  }
  return { level, intro, sections, skipped };
}

/** The blocks of a page copied as new blocks: its text and tables. */
export function copyBlocks(blocks: readonly BlockJson[]): NewBlock[] {
  const out: NewBlock[] = [];
  for (const block of blocks) {
    if (block.type === 'text' && markdownOf(block).trim() !== '') {
      out.push({ id: newId(), type: 'text', data: { markdown: markdownOf(block) } });
    } else if (block.type === 'table') {
      out.push(copyTable(block));
    }
  }
  return out;
}

/** Pages joined into one: each title as a heading, then the page's text and tables. */
export function mergeBlocks(pages: readonly { title: string; blocks: readonly BlockJson[] }[]): NewBlock[] {
  const out: NewBlock[] = [];
  for (const page of pages) {
    const title = page.title.replace(/\s+/g, ' ').trim();
    out.push({ id: newId(), type: 'text', data: { markdown: `# ${title.replace(/^#+\s*/, '') || '​'}` } });
    out.push(...copyBlocks(page.blocks));
  }
  return out;
}

/** A title for text pulled out of a page: its first heading, else its first words. */
export function extractTitle(markdown: string, fallback: string, max = 60): string {
  const doc = parseTextBlock(markdown);
  let title = '';
  doc.descendants((node) => {
    if (title) return false;
    if (node.isTextblock) {
      title = node.textContent.replace(/\s+/g, ' ').trim();
      return false;
    }
    return true;
  });
  if (title === '') return fallback;
  return title.length > max ? `${title.slice(0, max - 1).trimEnd()}…` : title;
}

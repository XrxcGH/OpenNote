// Turns a Markdown file into prose lines and blocks, skipping code, front matter, and comments.

import type { ProseBlock, ProseContext, ProseLine } from './types.ts';
import { cleanInline } from './text.ts';

interface ScanState {
  inFence: boolean;
  inComment: boolean;
  inFrontMatter: boolean;
}

export function markdownProse(lines: string[]): ProseLine[] {
  const state: ScanState = { inFence: false, inComment: false, inFrontMatter: lines[0] === '---' };
  const result: ProseLine[] = [];
  lines.forEach((raw, index) => {
    const prose = classifyLine(raw, index, state);
    if (prose) result.push(prose);
  });
  return result;
}

function classifyLine(raw: string, index: number, state: ScanState): ProseLine | undefined {
  if (state.inFrontMatter) {
    if (index > 0 && raw === '---') state.inFrontMatter = false;
    return undefined;
  }
  if (/^\s*(```|~~~)/.test(raw)) {
    state.inFence = !state.inFence;
    return undefined;
  }
  if (state.inFence) return undefined;
  const withoutComments = stripHtmlComments(raw, state);
  if (withoutComments.trim() === '') return undefined;
  return describeLine(raw, withoutComments, index + 1);
}

function stripHtmlComments(raw: string, state: ScanState): string {
  let text = raw;
  if (state.inComment) {
    const end = text.indexOf('-->');
    if (end === -1) return '';
    state.inComment = false;
    text = text.slice(end + 3);
  }
  text = text.replace(/<!--.*?-->/g, '');
  const start = text.indexOf('<!--');
  if (start !== -1) {
    state.inComment = true;
    text = text.slice(0, start);
  }
  return text;
}

function describeLine(raw: string, text: string, line: number): ProseLine | undefined {
  const heading = /^(#{1,6})\s+(.*)$/.exec(text);
  if (heading) {
    const level = heading[1].length;
    return { line, raw, text: cleanInline(heading[2]), context: 'heading', headingLevel: level };
  }
  if (/^\s*\|/.test(text)) {
    if (/^\s*\|?[\s:|-]+\|?\s*$/.test(text)) return undefined;
    return { line, raw, text: cleanInline(text.replace(/\|/g, ' | ')), context: 'table' };
  }
  const quote = /^\s*>\s?(.*)$/.exec(text);
  if (quote) return { line, raw, text: cleanInline(quote[1]), context: 'quote' };
  const list = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(text);
  if (list) return { line, raw, text: cleanInline(list[1]), context: 'list' };
  // Indented lines usually continue a list item.
  const context: ProseContext = /^\s{2,}\S/.test(text) ? 'list' : 'paragraph';
  return { line, raw, text: cleanInline(text), context };
}

/** Groups prose lines into blocks: a paragraph, a list item (with continuation lines), a heading or a table row. */
export function markdownBlocks(lines: string[], prose: ProseLine[]): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let current: ProseBlock | undefined;
  let previousLine = -1;
  for (const item of prose) {
    const adjacent = item.line === previousLine + 1;
    const startsItem = /^\s*(?:[-*+]|\d+[.)])\s+/.test(item.raw);
    const joins = current !== undefined && adjacent && canJoin(current, item, startsItem);
    if (joins && current) {
      current.text = `${current.text} ${item.text}`;
    } else {
      current = { line: item.line, text: item.text, context: item.context, headingLevel: item.headingLevel };
      blocks.push(current);
    }
    previousLine = item.line;
  }
  return blocks;
}

function canJoin(block: ProseBlock, item: ProseLine, startsItem: boolean): boolean {
  if (block.context === 'heading' || block.context === 'table') return false;
  if (item.context === 'heading' || item.context === 'table' || startsItem) return false;
  if (block.context === 'quote') return item.context === 'quote';
  return true;
}

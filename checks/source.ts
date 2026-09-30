// Builds the SourceFile objects that rules inspect. Expensive views are computed once, on demand.

import type { FileKind, ProseBlock, ProseLine, SourceFile } from './types.ts';
import { markdownBlocks, markdownProse } from './markdown.ts';
import { CODE_EXTENSIONS, splitCode } from './comments.ts';

const MARKDOWN_EXTENSIONS = ['md', 'mdx', 'markdown'];
const TEXT_EXTENSIONS = ['txt'];
const DATA_EXTENSIONS = ['json', 'jsonc', 'csv', 'svg', 'lock'];

export function fileKind(path: string): FileKind {
  const ext = extension(path);
  if (MARKDOWN_EXTENSIONS.includes(ext)) return 'markdown';
  if (TEXT_EXTENSIONS.includes(ext)) return 'text';
  if (CODE_EXTENSIONS.includes(ext)) return 'code';
  if (DATA_EXTENSIONS.includes(ext)) return 'data';
  return 'other';
}

export function extension(path: string): string {
  const base = path.split('/').pop() ?? path;
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

export function createSourceFile(path: string, text: string): SourceFile {
  const lines = text.split('\n');
  const kind = fileKind(path);
  const ext = extension(path);
  let prose: ProseLine[] | undefined;
  let blocks: ProseBlock[] | undefined;
  let code: string[] | undefined;
  const split = () => splitCode(lines, ext);
  return {
    path,
    text,
    lines,
    kind,
    ext,
    prose() {
      prose ??= computeProse(kind, lines, split);
      return prose;
    },
    blocks() {
      blocks ??= kind === 'markdown' ? markdownBlocks(lines, this.prose()) : commentBlocks(this.prose());
      return blocks;
    },
    codeOnly() {
      code ??= kind === 'code' ? split().code : [];
      return code;
    },
  };
}

function computeProse(kind: FileKind, lines: string[], split: () => { comments: ProseLine[] }): ProseLine[] {
  if (kind === 'markdown') return markdownProse(lines);
  if (kind === 'code') return split().comments;
  if (kind === 'text') {
    return lines
      .map((raw, i): ProseLine => ({ line: i + 1, raw, text: raw.trim(), context: 'paragraph' }))
      .filter((p) => p.text !== '');
  }
  return [];
}

/** Joins runs of adjacent comment (or plain text) lines into one block each. */
function commentBlocks(prose: ProseLine[]): ProseBlock[] {
  const blocks: ProseBlock[] = [];
  let previousLine = -1;
  for (const item of prose) {
    const last = blocks[blocks.length - 1];
    if (last && item.line === previousLine + 1) {
      last.text = `${last.text} ${item.text}`;
    } else {
      blocks.push({ line: item.line, text: item.text, context: item.context });
    }
    previousLine = item.line;
  }
  return blocks;
}

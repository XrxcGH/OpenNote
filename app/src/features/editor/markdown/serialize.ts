// A ProseMirror text block document to canonical OpenNote Markdown (SPEC 7.2 and 7.7). The same document always gives
// the same string, so saving, reloading, and undo give identical text.
import type { Node as PMNode } from '@tiptap/pm/model';
import { CALLOUT_TYPE_PATTERN, FOLDS, LANGUAGE_PATTERN } from '../schema/specs';
import { PARAGRAPH, TITLE, cleanText } from './escape';
import { serializeInline } from './inline';
import { joinAdjacentLists } from './normalize';

function childrenOf(node: PMNode): PMNode[] {
  const out: PMNode[] = [];
  node.forEach((child) => out.push(child));
  return out;
}

/** Markdown cannot hold an empty paragraph between blocks, so one is dropped. */
const isEmptyParagraph = (node: PMNode) => node.type.name === 'paragraph' && node.content.size === 0;

function fenceText(node: PMNode): string {
  const source = cleanText(node.textContent);
  const language = node.attrs.language as string | null;
  const runs = source.split('\n').map((line) => /^ {0,3}(`+)/.exec(line)?.[1].length ?? 0);
  const fence = '`'.repeat(Math.max(3, ...runs.map((run) => run + 1)));
  const info = language && LANGUAGE_PATTERN.test(language) ? language : '';
  return source === '' ? `${fence}${info}\n${fence}` : `${fence}${info}\n${source}\n${fence}`;
}

function quoted(text: string): string {
  return text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n');
}

function calloutText(node: PMNode): string {
  const [title, ...body] = childrenOf(node);
  const type = CALLOUT_TYPE_PATTERN.test(node.attrs.type as string) ? (node.attrs.type as string) : 'note';
  const fold = (FOLDS as readonly string[]).includes(node.attrs.fold as string) ? (node.attrs.fold as string) : '';
  const line = title ? serializeInline(title, TITLE, true) : '';
  const head = `[!${type}]${fold}${line === '' ? '' : ` ${line}`}`;
  const rest = blocksText(body);
  return quoted(rest === '' ? head : `${head}\n\n${rest}`);
}

function taskPrefix(checked: boolean | null): string {
  return checked === null ? '' : checked ? '[x] ' : '[ ] ';
}

/** The text of one list item: its marker on the first line, and every later line indented to the marker's width. */
function itemText(item: PMNode, marker: string): { text: string; blocks: number } {
  const [first, ...rest] = childrenOf(item);
  const lead = first ? blockText(first) : '';
  const others = joinAdjacentLists(rest)
    .filter((node) => !isEmptyParagraph(node))
    .map(blockText);
  const checked = item.attrs.checked as boolean | null;
  // An item with no text cannot be followed by a paragraph, so its blocks start on the next line. A task item still
  // has its `[ ]` line, which a block on the next line would join, so a blank line separates them.
  const bare = lead === '' && checked === null && others.length > 0;
  const body = (bare ? others : [lead, ...others]).join('\n\n').split('\n');
  const lines = bare ? ['', ...body] : body;
  const head = marker + taskPrefix(checked);
  const indent = ' '.repeat(marker.length);
  const text = lines.map((line, i) =>
    i === 0 ? (line === '' ? head.trimEnd() : head + line) : line === '' ? '' : indent + line,
  );
  return { text: text.join('\n'), blocks: others.length + 1 };
}

function listText(list: PMNode): string {
  const ordered = list.type.name === 'orderedList';
  const start = ordered ? Math.max(0, Math.floor(Number(list.attrs.start) || 0)) : 0;
  const items = childrenOf(list).map((item, i) => itemText(item, ordered ? `${start + i}. ` : '- '));
  const loose = items.some((item) => item.blocks > 1);
  return items.map((item) => item.text).join(loose ? '\n\n' : '\n');
}

function blockText(node: PMNode): string {
  switch (node.type.name) {
    case 'paragraph':
      return serializeInline(node, PARAGRAPH);
    case 'heading': {
      const level = Math.min(6, Math.max(1, Number(node.attrs.level) || 1));
      const text = serializeInline(node, TITLE, true);
      return text === '' ? '#'.repeat(level) : `${'#'.repeat(level)} ${text}`;
    }
    case 'bulletList':
    case 'orderedList':
      return listText(node);
    case 'blockquote':
      return quoted(blocksText(childrenOf(node)));
    case 'callout':
      return calloutText(node);
    case 'codeBlock':
      return fenceText(node);
    case 'mathBlock':
      return `$$\n${cleanText(node.attrs.source as string)}\n$$`;
    case 'horizontalRule':
      return '---';
    default:
      return '';
  }
}

/** Blocks joined by one blank line. */
function blocksText(nodes: readonly PMNode[]): string {
  return joinAdjacentLists(nodes)
    .filter((node) => !isEmptyParagraph(node))
    .map(blockText)
    .join('\n\n');
}

/** The canonical `markdown` string of a text block (SPEC 7.7): no blank line at the start, no newline at the end. */
export function serializeTextBlock(doc: PMNode): string {
  return blocksText(childrenOf(doc));
}

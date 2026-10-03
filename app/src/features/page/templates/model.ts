// Page templates and series pages. A template is an ordinary page,
// marked with the tag "template". Its text and tables are copied into a new page or into the page being written,
// with {{date}}, {{time}}, {{title}}, and {{cursor}} filled in. A series page copies the structure of the last page
// in the series: its headings and its checklists, with the unfinished items carried forward if the person wants.
// This file is the logic on Markdown and documents, with no page service in it.
import { Fragment } from '@tiptap/pm/model';
import type { Node as PMNode } from '@tiptap/pm/model';
import { newId } from '../../../editor/ids';
import { createMarkdownCache, parseTextBlock, serializeTextBlock } from '../../../editor/markdown';
import type { BlockJson, NewBlock } from '../../../services/pages/types';
import { tableText } from '../qol/words';

/** A private-use character standing for the caret in text that is parsed, so its place survives parsing. */
const CURSOR = '';

export interface Placeholders {
  date: string;
  time: string;
  title: string;
}

const PLACEHOLDER = /\{\{\s*(date|time|title|cursor)\s*\}\}/gi;

/** The text with each placeholder replaced; {{cursor}} becomes a marker, and `cursor` says whether one was there. */
export function expandPlaceholders(text: string, values: Placeholders): { text: string; cursor: boolean } {
  let cursor = false;
  const expanded = text.replace(PLACEHOLDER, (_all, name: string) => {
    const key = name.toLowerCase();
    if (key === 'cursor') {
      if (cursor) return '';
      cursor = true;
      return CURSOR;
    }
    return values[key as keyof Placeholders];
  });
  return { text: expanded, cursor };
}

export interface TemplateCursor {
  /** The new block that holds the caret. */
  block: string;
  /** The caret's position in that block's document. */
  pos: number;
}

export interface TemplateResult {
  blocks: NewBlock[];
  cursor: TemplateCursor | null;
}

/** Where the cursor marker is in a document, and the document without it. */
function takeCursor(markdown: string): { markdown: string; pos: number } | null {
  if (!markdown.includes(CURSOR)) return null;
  const doc = parseTextBlock(markdown);
  let pos = -1;
  doc.descendants((node, at) => {
    if (pos === -1 && node.isText && node.text?.includes(CURSOR)) pos = at + (node.text?.indexOf(CURSOR) ?? 0);
    return pos === -1;
  });
  return pos === -1 ? null : { markdown: markdown.split(CURSOR).join(''), pos };
}

/** The blocks of a template as new blocks: text and tables, placeholders filled in, in reading order. */
export function fromTemplate(blocks: readonly BlockJson[], values: Placeholders): TemplateResult {
  const out: NewBlock[] = [];
  let cursor: TemplateCursor | null = null;
  for (const block of blocks) {
    if (block.type === 'text') {
      const source = typeof block.data.markdown === 'string' ? block.data.markdown : '';
      const filled = expandPlaceholders(source, values);
      if (filled.text.trim() === '') continue;
      const id = newId();
      let markdown = filled.text;
      if (filled.cursor && !cursor) {
        const found = takeCursor(markdown);
        if (found) {
          markdown = found.markdown;
          cursor = { block: id, pos: found.pos };
        }
      }
      out.push({ id, type: 'text', data: { markdown: markdown.split(CURSOR).join('') } });
    } else if (block.type === 'table') {
      const text = JSON.stringify(block.data);
      const filled = expandPlaceholders(text, values).text.split(CURSOR).join('');
      out.push({ id: newId(), type: 'table', data: JSON.parse(filled) as Record<string, unknown> });
    }
  }
  return { blocks: out, cursor };
}

/** The text of a template for its preview line: the first words of its first text. */
export function previewOf(blocks: readonly BlockJson[], max = 80): string {
  for (const block of blocks) {
    const text =
      block.type === 'text' ? String(block.data.markdown ?? '') : block.type === 'table' ? tableText(block.data) : '';
    const line = text
      .replace(/[#>*_`[\]-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
  }
  return '';
}

// Series pages.

const isList = (node: PMNode) => node.type.name === 'bulletList' || node.type.name === 'orderedList';
const isTask = (node: PMNode) => node.type.name === 'listItem' && typeof node.attrs.checked === 'boolean';

/** A list kept to what the next page needs: its task items, unchecked, and only the unfinished ones if `carry`. */
function keepTasks(list: PMNode, carry: boolean): PMNode | null {
  const items: PMNode[] = [];
  list.forEach((item) => {
    if (!isTask(item)) return;
    if (carry && item.attrs.checked === true) return;
    // The item's own paragraph first, then its kept sub-lists.
    const own: PMNode[] = [];
    const lists: PMNode[] = [];
    item.forEach((child) => {
      if (isList(child)) {
        const kept = keepTasks(child, carry);
        if (kept) lists.push(kept);
      } else own.push(child);
    });
    items.push(item.type.create({ ...item.attrs, checked: false }, Fragment.from([...own, ...lists])));
  });
  return items.length === 0 ? null : list.type.create(list.attrs, Fragment.from(items));
}

/**
 * The next page's text from the last one: the headings stay, with their order, and the checklists stay as lists of
 * open items. Other text does not carry over. With `carry`, finished items are left behind, so only the unfinished
 * ones come forward.
 */
export function seriesStructure(markdown: string, carry: boolean): string {
  const doc = parseTextBlock(markdown);
  const kept: PMNode[] = [];
  doc.forEach((node) => {
    if (node.type.name === 'heading') kept.push(node);
    else if (isList(node)) {
      const list = keepTasks(node, carry);
      if (list) kept.push(list);
    }
  });
  if (kept.length === 0) return '';
  return serializeTextBlock(doc.type.create(null, Fragment.from(kept)), createMarkdownCache());
}

/** The series' title without the date the last page added: "Weekly review · Oct 3, 2026" is "Weekly review". */
export function seriesBase(title: string): string {
  return title.replace(/\s*[·\-–—|]\s*[A-Z][a-z]{2,8}\.? \d{1,2},? \d{4}\s*$/, '').trim() || title;
}

/** A link to a page in Markdown. */
export function pageLink(title: string, page: string): string {
  const text = title.replace(/[[\]\\]/g, ' ').trim() || 'Untitled page';
  return `[${text}](opennote:page/${page})`;
}

/** The structure of a whole series page, as new blocks: the date line, the link back, and the carried text. */
export function seriesBlocks(
  last: readonly BlockJson[],
  options: {
    dateLine: string;
    previous: { title: string; page: string } | null;
    previousLabel: string;
    carry: boolean;
  },
): NewBlock[] {
  const out: NewBlock[] = [{ id: newId(), type: 'text', data: { markdown: options.dateLine } }];
  if (options.previous) {
    const link = pageLink(options.previous.title, options.previous.page);
    out.push({ id: newId(), type: 'text', data: { markdown: `${options.previousLabel} ${link}` } });
  }
  for (const block of last) {
    if (block.type !== 'text') continue;
    const markdown = seriesStructure(typeof block.data.markdown === 'string' ? block.data.markdown : '', options.carry);
    if (markdown.trim() !== '') out.push({ id: newId(), type: 'text', data: { markdown } });
  }
  return out;
}

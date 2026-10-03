// The tag summary: the tagged lines and open checkboxes of the text blocks the index hands over, as lines of text
// that can be grouped by tag, by page, or by date. A block's Markdown is read with the editor's own parser, so a
// line here is exactly the paragraph, heading, or list item the editor shows.
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseTextBlock } from '../../../editor/markdown';
import type { TaggedBlock } from '../../../services/search/types';
import { listElements } from '../elements/model';
import { TODO, tagName } from './defs';

export type Box = 'open' | 'done';

export interface TaggedLine {
  /** Unique within a summary. */
  key: string;
  page: string;
  title: string;
  notebook: string;
  section: string;
  /** Unix milliseconds: when the page last changed. */
  modified: number;
  block: string;
  /** The line's element ID, when the block names one. */
  element: string | null;
  text: string;
  tags: string[];
  /** The line's checkbox: a To do tag or a task item. Null for a line without one. */
  box: Box | null;
  /** Which kind of box: the To do tag keeps its state in the block's data, and a task item in its Markdown. */
  boxKind: 'tag' | 'task' | null;
  /** For a task item, its place among the block's task items. */
  taskIndex: number;
}

/** The text of an element's first line: a list item's own paragraph, without the lists under it. */
function lineText(node: PMNode): string {
  const lead = node.type.name === 'listItem' ? node.firstChild : node;
  return (lead?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** The lines of one block. */
export function linesOf(block: TaggedBlock): TaggedLine[] {
  const lines: TaggedLine[] = [];
  const checked = new Set(block.checked);
  let task = -1;
  for (const ref of listElements(parseTextBlock(block.markdown))) {
    const isTask =
      ref.node.type.name === 'listItem' && ref.node.attrs.checked !== null && ref.node.attrs.checked !== undefined;
    if (isTask) task += 1;
    const id = block.ids[ref.index] ?? null;
    const tags = id ? (block.tags[id] ?? []) : [];
    const hasTodo = tags.includes(TODO);
    const openTask = isTask && ref.node.attrs.checked === false;
    if (tags.length === 0 && !openTask) continue;
    const box: Box | null = hasTodo
      ? id && checked.has(id)
        ? 'done'
        : 'open'
      : isTask
        ? openTask
          ? 'open'
          : 'done'
        : null;
    lines.push({
      key: `${block.block}:${ref.index}`,
      page: block.page,
      title: block.title,
      notebook: block.notebook,
      section: block.section,
      modified: block.modified,
      block: block.block,
      element: id,
      text: lineText(ref.node),
      tags,
      box,
      boxKind: hasTodo ? 'tag' : isTask ? 'task' : null,
      taskIndex: isTask ? task : -1,
    });
  }
  return lines;
}

export function linesOfBlocks(blocks: readonly TaggedBlock[]): TaggedLine[] {
  return blocks.flatMap(linesOf);
}

export type GroupBy = 'tag' | 'page' | 'date';

export interface Group {
  key: string;
  label: string;
  lines: TaggedLine[];
}

const dayLabel = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/** The lines in groups. A line with two tags is in both of their groups under Tag. */
export function groupLines(lines: readonly TaggedLine[], by: GroupBy, openLabel: string): Group[] {
  const groups = new Map<string, Group>();
  const add = (key: string, label: string, line: TaggedLine, order: string) => {
    const found = groups.get(order + key) ?? { key: order + key, label, lines: [] };
    found.lines.push(line);
    groups.set(order + key, found);
  };
  for (const line of lines) {
    if (by === 'page') add(line.page, line.title, line, '');
    else if (by === 'date') {
      const day = new Date(line.modified);
      const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
      add(key, dayLabel(line.modified), line, '');
    } else if (line.tags.length === 0) add('~', openLabel, line, '~');
    else line.tags.forEach((tag) => add(tag, tagName(tag), line, ''));
  }
  const sorted = [...groups.values()].sort((a, b) =>
    by === 'date' ? b.key.localeCompare(a.key) : a.key.localeCompare(b.key),
  );
  return sorted;
}

/** The Markdown of a summary page: a heading for each group and a line for each item, linked back to its page. */
export function summaryMarkdown(groups: readonly Group[]): string {
  const parts: string[] = [];
  for (const group of groups) {
    parts.push(`## ${group.label}`, '');
    for (const line of group.lines) {
      const box = line.box === 'open' ? '- [ ] ' : line.box === 'done' ? '- [x] ' : '- ';
      parts.push(`${box}${line.text} [[${line.title.replace(/[[\]#|]/g, '')}]]`);
    }
    parts.push('');
  }
  return parts.join('\n').trimEnd() + '\n';
}

const TASK_LINE = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\].*)$/;

/** The Markdown with the nth task item checked or unchecked. Task markers inside fenced code are not counted. */
export function setTaskBox(markdown: string, index: number, done: boolean): string | null {
  const lines = markdown.split('\n');
  let fence = false;
  let seen = -1;
  for (let at = 0; at < lines.length; at += 1) {
    if (/^\s*(```|~~~)/.test(lines[at])) fence = !fence;
    if (fence) continue;
    const match = TASK_LINE.exec(lines[at]);
    if (!match) continue;
    seen += 1;
    if (seen !== index) continue;
    lines[at] = `${match[1]}${done ? 'x' : ' '}${match[3]}`;
    return lines.join('\n');
  }
  return null;
}

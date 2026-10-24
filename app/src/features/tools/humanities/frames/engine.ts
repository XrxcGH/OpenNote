// Note frames: ready-made outlines for analytical writing and record keeping. Each frame is an outline in a small
// line language, kept in the strings so it can be translated whole:
//   # Heading        a heading; ## for a smaller one
//   > Prompt         a line of guidance the student can delete
//   - Item           a bullet; 1. Item for a numbered item
//   | A | B | C |    the table's header; later lines that start with | name the first cell of each row
// A frame has at most one table, and it comes last, because the page adds a table after the text before it.

export type FrameGroup =
  | 'writing'
  | 'history'
  | 'law'
  | 'policy'
  | 'education'
  | 'fieldwork'
  | 'collections'
  | 'arts'
  | 'business'
  | 'science';

export type FrameBlock =
  | { kind: 'heading'; level: 2 | 3; text: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'numbered'; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] };

export interface FrameText {
  name: string;
  use: string;
  keywords: string;
  outline: string;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());

function addItem(blocks: FrameBlock[], kind: 'bullets' | 'numbered', text: string): void {
  const last = blocks[blocks.length - 1];
  if (last?.kind === kind) last.items.push(text);
  else blocks.push({ kind, items: [text] });
}

/** The outline as blocks. A table with no named rows gets `emptyRows` empty rows. */
export function parseOutline(outline: string, emptyRows = 4): FrameBlock[] {
  const blocks: FrameBlock[] = [];
  let table: { header: string[]; rows: string[][] } | null = null;
  for (const raw of outline.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    if (line.startsWith('|')) {
      const parts = cells(line);
      if (!table) table = { header: parts, rows: [] };
      else table.rows.push(table.header.map((_, index) => parts[index] ?? ''));
    } else if (line.startsWith('## ')) blocks.push({ kind: 'heading', level: 3, text: line.slice(3).trim() });
    else if (line.startsWith('# ')) blocks.push({ kind: 'heading', level: 2, text: line.slice(2).trim() });
    else if (line.startsWith('> ')) blocks.push({ kind: 'prompt', text: line.slice(2).trim() });
    else if (line.startsWith('- ')) addItem(blocks, 'bullets', line.slice(2).trim());
    else if (/^\d+\.\s/.test(line)) addItem(blocks, 'numbered', line.replace(/^\d+\.\s+/, ''));
    else blocks.push({ kind: 'prompt', text: line });
  }
  if (table) {
    const rows =
      table.rows.length > 0 ? table.rows : Array.from({ length: emptyRows }, () => table!.header.map(() => ''));
    blocks.push({ kind: 'table', header: table.header, rows });
  }
  return blocks;
}

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The frame's text blocks as page HTML, the guidance line first. The table goes on the page on its own. */
export function frameHtml(blocks: readonly FrameBlock[], use: string): string {
  const parts = [`<p><em>${escape(use)}</em></p>`];
  for (const block of blocks) {
    if (block.kind === 'heading') parts.push(`<h${block.level}>${escape(block.text)}</h${block.level}>`);
    else if (block.kind === 'prompt') parts.push(`<p><em>${escape(block.text)}</em></p>`);
    else if (block.kind === 'bullets' || block.kind === 'numbered') {
      const tag = block.kind === 'bullets' ? 'ul' : 'ol';
      parts.push(`<${tag}>${block.items.map((item) => `<li><p>${escape(item)}</p></li>`).join('')}</${tag}>`);
    }
  }
  return parts.join('');
}

export function frameTable(blocks: readonly FrameBlock[]): { header: string[]; rows: string[][] } | null {
  const table = blocks.find((block) => block.kind === 'table');
  return table?.kind === 'table' ? { header: table.header, rows: table.rows } : null;
}

export const headings = (blocks: readonly FrameBlock[]): string[] =>
  blocks.flatMap((block) => (block.kind === 'heading' ? [block.text] : []));

export interface FrameEntry {
  id: string;
  group: FrameGroup;
  name: string;
  keywords: string;
  groupName: string;
}

function score(entry: FrameEntry, words: readonly string[]): number {
  const name = entry.name.toLowerCase();
  const keywords = entry.keywords.toLowerCase();
  const group = entry.groupName.toLowerCase();
  let total = 0;
  for (const word of words) {
    const nameWords = name.split(/[^\p{L}\p{N}]+/u);
    if (nameWords.some((part) => part.startsWith(word))) total += 4;
    else if (name.includes(word)) total += 3;
    else if (keywords.includes(word)) total += 2;
    else if (group.includes(word)) total += 1;
    else return 0;
  }
  return total;
}

/** The frames that match every word of the query, best first: a name match beats a keyword or subject match. */
export function searchFrames(query: string, entries: readonly FrameEntry[]): FrameEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...entries];
  return entries
    .map((entry, index) => ({ entry, index, score: score(entry, words) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((item) => item.entry);
}

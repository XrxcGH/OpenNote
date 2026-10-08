// Markdown export of a page: the body of `page.md` (format spec 11.1), with the front matter other tools read. The
// blocks come in reading order. Text is copied as it is and tables become GFM tables. Images link to their asset
// files, and drawings add their description. Element IDs, tags, and styles are left out so the text stays clean.

import { own } from '../layout/json';
import { escapeText, oneLine, rewriteLinks, writeDestination } from './escape';
import { readingOrder } from './order';
import type { ExportBlock, ExportPage, TableBlock } from './source';

/** The line for a block of a type this version doesn't know, and for a block that couldn't be read. */
export const NEWER_VERSION_LINE = '*This part of the page needs a newer version of OpenNote.*';
/** The line that shows the page's handwriting. */
export const HANDWRITING_LINE = '![Handwriting on this page](ink.svg)';

export interface MarkdownOptions {
  /**
   * `none` leaves the front matter out. `basic` writes the title, tags, and dates, which Obsidian, Hugo, and Pandoc
   * read. The `opennote` block and its checksum belong to the page's own readable copy, so an export never has them.
   */
  readonly frontMatter?: 'none' | 'basic';
  /** The path to write for an asset. The default is `assets/<file name>`. Null keeps the `asset:` link. */
  readonly assetPath?: (assetId: string, file: string) => string | null;
  /** The relative path to another page's Markdown. Without it, page links stay as they are. */
  readonly pagePath?: (pageId: string) => string | null;
  /** The line that shows the handwriting, or null to leave it out. Default: `HANDWRITING_LINE`. */
  readonly handwriting?: string | null;
  /** The line for a block this version can't show. */
  readonly newerVersion?: string;
}

export interface BodyPart {
  /** The block the part renders, or null for the title and the handwriting line. */
  readonly block: string | null;
  readonly text: string;
}

export interface MarkdownExport {
  readonly markdown: string;
  readonly parts: readonly BodyPart[];
  /** The assets the Markdown links to, so the caller can copy their files next to it. */
  readonly assets: readonly string[];
}

/** A string as a JSON string, so any title is valid YAML. */
const quoted = (text: string): string => JSON.stringify(text);

export function hasInk(page: ExportPage): boolean {
  return page.strokes.length > 0 || page.blocks.some((b) => b.type === 'ink' && b.strokeCount > 0);
}

class Exporter {
  readonly used = new Set<string>();

  constructor(
    private readonly page: ExportPage,
    private readonly o: MarkdownOptions,
  ) {}

  private assetDestination(id: string): string {
    const file = own(this.page.assets, id)?.file;
    if (file === undefined) return `asset:${id}`;
    const path = this.o.assetPath ? this.o.assetPath(id, file) : `assets/${file}`;
    if (path === null) return `asset:${id}`;
    this.used.add(id);
    return writeDestination(path);
  }

  rewrite(markdown: string): string {
    return rewriteLinks(markdown, {
      page: (id) => this.o.pagePath?.(id) ?? null,
      asset: (id) => {
        const file = own(this.page.assets, id)?.file;
        if (file === undefined) return null;
        const path = this.o.assetPath ? this.o.assetPath(id, file) : `assets/${file}`;
        if (path !== null) this.used.add(id);
        return path;
      },
    });
  }

  private description(text: string): string {
    return escapeText(oneLine(text).trim(), false);
  }

  block(block: ExportBlock): string | null {
    switch (block.type) {
      case 'text':
        return this.rewrite(block.markdown);
      case 'image':
        return `![${block.decorative ? '' : this.description(block.alt)}](${this.assetDestination(block.asset)})`;
      case 'file': {
        const name = own(this.page.assets, block.asset)?.name ?? block.asset;
        return `[${this.description(name)}](${this.assetDestination(block.asset)})`;
      }
      case 'table':
        return this.table(block);
      case 'ink': {
        const text = this.description(block.alt);
        return block.role === 'drawing' && !block.decorative && text !== '' ? `*${text}*` : null;
      }
      case 'other':
        return block.fallback === undefined
          ? (this.o.newerVersion ?? NEWER_VERSION_LINE)
          : this.rewrite(block.fallback);
    }
  }

  /** A GFM table, with an empty header row when the table has none. Null for a table without columns. */
  private table(table: TableBlock): string | null {
    if (table.columns.length === 0) return null;
    const line = (cells: readonly string[]) => `| ${cells.join(' | ')} |`;
    const cellsOf = (row: TableBlock['rows'][number]) =>
      table.columns.map((c) => tableCell(this.rewrite(own(row.cells, c.id) ?? '')));
    const [first, ...rest] = table.rows;
    const header = table.header && first ? cellsOf(first) : table.columns.map(() => '');
    const body = table.header && first ? rest : table.rows;
    return [line(header), line(table.columns.map(() => '---')), ...body.map((r) => line(cellsOf(r)))].join('\n');
  }
}

/** A cell's Markdown for a GFM table: hard breaks become `<br>`, and a `|` not already escaped gets a backslash. */
export function tableCell(markdown: string): string {
  const text = markdown.replace(/\\\n/g, '<br>').replace(/\n/g, ' ');
  let out = '';
  let escaped = false;
  for (const c of text) {
    if (c === '|' && !escaped) out += '\\';
    escaped = c === '\\' && !escaped;
    out += c;
  }
  return out;
}

function frontMatter(page: ExportPage): string {
  const lines = ['---', `title: ${quoted(page.title)}`];
  if (page.tags.length > 0) lines.push(`tags: [${page.tags.map(quoted).join(', ')}]`);
  if (page.created !== '') lines.push(`created: ${quoted(page.created)}`);
  if (page.modified !== '') lines.push(`modified: ${quoted(page.modified)}`);
  return `${lines.join('\n')}\n---\n`;
}

/** The parts of the body, in the order the file writes them. */
export function bodyParts(page: ExportPage, options: MarkdownOptions = {}): { parts: BodyPart[]; assets: string[] } {
  const exporter = new Exporter(page, options);
  const parts: BodyPart[] = [];
  const title = oneLine(page.title);
  if (title !== '') parts.push({ block: null, text: `# ${escapeText(title, true)}` });
  const handwriting = options.handwriting === undefined ? HANDWRITING_LINE : options.handwriting;
  if (handwriting !== null && hasInk(page)) parts.push({ block: null, text: handwriting });
  for (const block of readingOrder(page.blocks, page.view.readingOrder)) {
    const text = exporter.block(block);
    if (text !== null && text !== '') parts.push({ block: block.id, text });
  }
  return { parts, assets: [...exporter.used] };
}

/** The page as Markdown. The text ends with one newline, and holds no U+0000. */
export function exportMarkdown(page: ExportPage, options: MarkdownOptions = {}): MarkdownExport {
  const { parts, assets } = bodyParts(page, options);
  const front = (options.frontMatter ?? 'basic') === 'basic' ? frontMatter(page) : '';
  const body = parts.map((p) => p.text).join('\n\n');
  const markdown = body === '' ? front : `${front === '' ? '' : `${front}\n`}${body}\n`;
  return { markdown: markdown.replace(/\0/g, '�'), parts, assets };
}

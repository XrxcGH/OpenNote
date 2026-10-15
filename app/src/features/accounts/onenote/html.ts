// OneNote's page HTML into blocks. Microsoft Graph gives a page as HTML with absolute positions, spans with styles,
// to-do tags, images with a full-size address, tables, and attachments as objects. This reads that HTML (without a
// browser, so it runs anywhere) and answers the page's blocks: text blocks as Markdown and pictures to fetch, and a
// count of what could not come over, for the import report.

import { isInk, parseInk } from './inkml';
import type { InkSpec } from './inkml';

export type PageBlock =
  | { kind: 'text'; markdown: string }
  | { kind: 'image'; src: string; alt: string; width: number | null }
  | { kind: 'attachment'; src: string; name: string; mime: string }
  | { kind: 'ink'; strokes: InkSpec[] };

/** What was simplified or left out of one page. */
export interface PageLosses {
  tables: number;
  /** Attachments with no address to fetch them from. */
  attachments: string[];
  /** Ink the page had, in strokes, which the importer draws. */
  ink: number;
  /** Pictures that could not be fetched are counted by the importer. */
  other: string[];
}

export interface ConvertedPage {
  title: string;
  blocks: PageBlock[];
  losses: PageLosses;
}

interface El {
  tag: string;
  attrs: Record<string, string>;
  children: (El | string)[];
}

const VOID = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'col', 'area', 'base', 'source', 'wbr']);
const SKIP = new Set(['script', 'style', 'head', 'title']);
const CONTAINERS = new Set(['#root', 'html', 'body']);
const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
};

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name.startsWith('#')) {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function attributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    attrs[(match[1] ?? '').toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attrs;
}

/** A small, forgiving HTML reader: enough for what OneNote writes. Unclosed and stray tags are tolerated. */
function parse(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] };
  const stack: El[] = [root];
  const pattern = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+|<)/g;
  for (let match = pattern.exec(html); match; match = pattern.exec(html)) {
    const top = stack[stack.length - 1] as El;
    if (match[4] !== undefined) {
      top.children.push(decode(match[4]));
    } else if (match[2] !== undefined) {
      const tag = match[2].toLowerCase();
      if (match[1]) {
        const at = stack.map((one) => one.tag).lastIndexOf(tag);
        if (at > 0) stack.length = at;
      } else {
        const el: El = { tag, attrs: attributes(match[3] ?? ''), children: [] };
        top.children.push(el);
        if (!VOID.has(tag) && !(match[3] ?? '').trimEnd().endsWith('/')) stack.push(el);
      }
    }
  }
  return root;
}

const style = (el: El, name: string): string => {
  const found = new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, 'i').exec(el.attrs.style ?? '');
  return (found?.[1] ?? '').trim().toLowerCase();
};

/** Wraps text in a Markdown mark, keeping the spaces outside it. */
function mark(text: string, around: string): string {
  const inner = text.trim();
  if (inner === '') return text;
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
  return `${lead}${around}${inner}${around}${trail}`;
}

const escapeText = (text: string): string => text.replace(/([\\`*_[\]])/g, '\\$1');

interface Context {
  losses: PageLosses;
  blocks: PageBlock[];
  /** Blocks found inside a line of text, which go after the text block that line becomes. */
  pending: PageBlock[];
}

/** Adds a block, then the attachments and ink that were inside it. */
function emit(cx: Context, block: PageBlock): void {
  cx.blocks.push(block);
  cx.blocks.push(...cx.pending);
  cx.pending = [];
}

function takeInk(node: El, cx: Context): void {
  const strokes = parseInk(node);
  if (strokes.length === 0) return;
  cx.losses.ink += strokes.length;
  cx.pending.push({ kind: 'ink', strokes });
}

function inline(node: El | string, cx: Context): string {
  if (typeof node === 'string') return escapeText(node.replace(/\s+/g, ' '));
  if (SKIP.has(node.tag)) return '';
  if (node.tag === 'br') return '\n';
  if (isInk(node.tag)) {
    takeInk(node, cx);
    return '';
  }
  if (node.tag === 'object' && node.attrs['data-attachment']) {
    const name = node.attrs['data-attachment'];
    const src = node.attrs.data ?? '';
    if (src) cx.pending.push({ kind: 'attachment', src, name, mime: node.attrs.type ?? '' });
    else cx.losses.attachments.push(name);
    return `[${escapeText(name)}] `;
  }
  let text = node.children.map((child) => inline(child, cx)).join('');
  if (node.tag === 'a' && node.attrs.href) {
    text = text.trim() === '' ? '' : `[${text.trim()}](${node.attrs.href.replace(/\)/g, '%29')})`;
  }
  if (node.tag === 'strong' || node.tag === 'b' || /^(bold|[6-9]00)$/.test(style(node, 'font-weight'))) {
    text = mark(text, '**');
  }
  if (node.tag === 'em' || node.tag === 'i' || style(node, 'font-style') === 'italic') text = mark(text, '_');
  if (
    node.tag === 'del' ||
    node.tag === 's' ||
    node.tag === 'strike' ||
    style(node, 'text-decoration').includes('line-through')
  ) {
    text = mark(text, '~~');
  }
  if (node.tag === 'code' || /consolas|courier|monospace/.test(style(node, 'font-family'))) text = mark(text, '`');
  return text;
}

const clean = (text: string): string =>
  text
    .replace(/[ \t]*\n[ \t]*/g, '  \n')
    .replace(/ {2,}(?!\n)/g, ' ')
    .trim();

function todoMark(el: El): string | null {
  const tag = el.attrs['data-tag'] ?? '';
  if (tag.includes('to-do:completed')) return '- [x] ';
  if (tag.startsWith('to-do')) return '- [ ] ';
  return null;
}

function listLines(list: El, depth: number, cx: Context): string[] {
  const lines: string[] = [];
  let number = 1;
  for (const child of list.children) {
    if (typeof child === 'string' || child.tag !== 'li') continue;
    const own = child.children.filter((one) => typeof one === 'string' || (one.tag !== 'ul' && one.tag !== 'ol'));
    const text = clean(own.map((one) => inline(one, cx)).join(''));
    const bullet = todoMark(child) ?? (list.tag === 'ol' ? `${number}. ` : '- ');
    lines.push(`${'  '.repeat(depth)}${bullet}${text}`);
    number += 1;
    for (const nested of child.children) {
      if (typeof nested !== 'string' && (nested.tag === 'ul' || nested.tag === 'ol')) {
        lines.push(...listLines(nested, depth + 1, cx));
      }
    }
  }
  return lines;
}

function tableMarkdown(table: El, cx: Context): string {
  const rows: string[][] = [];
  const visit = (el: El) => {
    for (const child of el.children) {
      if (typeof child === 'string') continue;
      if (child.tag === 'tr') {
        rows.push(
          child.children
            .filter((cell): cell is El => typeof cell !== 'string' && (cell.tag === 'td' || cell.tag === 'th'))
            .map((cell) =>
              clean(cell.children.map((one) => inline(one, cx)).join(''))
                .replace(/\|/g, '\\|')
                .replace(/\n/g, ' '),
            ),
        );
      } else visit(child);
    }
  };
  visit(table);
  const width = Math.max(1, ...rows.map((row) => row.length));
  const pad = (row: string[]) => `| ${Array.from({ length: width }, (_, at) => row[at] ?? '').join(' | ')} |`;
  const [head = [], ...body] = rows;
  return [pad(head), `| ${Array.from({ length: width }, () => '---').join(' | ')} |`, ...body.map(pad)].join('\n');
}

function pixels(value: string | undefined): number | null {
  const found = /^(\d+(?:\.\d+)?)/.exec(value ?? '');
  return found ? Math.round(Number(found[1])) : null;
}

function flow(node: El | string, cx: Context): void {
  if (typeof node === 'string') {
    const text = clean(escapeText(node.replace(/\s+/g, ' ')));
    if (text !== '') emit(cx, { kind: 'text', markdown: text });
    return;
  }
  if (SKIP.has(node.tag)) return;
  if (isInk(node.tag)) {
    takeInk(node, cx);
    emitPending(cx);
    return;
  }
  if (node.tag === 'img') {
    const src = node.attrs['data-fullres-src'] || node.attrs.src;
    if (src) emit(cx, { kind: 'image', src, alt: node.attrs.alt ?? '', width: pixels(node.attrs.width) });
    return;
  }
  if (node.tag === 'hr') return;
  if (/^h[1-6]$/.test(node.tag)) {
    const text = clean(node.children.map((child) => inline(child, cx)).join('')).replace(/\n/g, ' ');
    if (text !== '') emit(cx, { kind: 'text', markdown: `${'#'.repeat(Number(node.tag[1]))} ${text}` });
    return;
  }
  if (node.tag === 'ul' || node.tag === 'ol') {
    const lines = listLines(node, 0, cx);
    if (lines.length > 0) emit(cx, { kind: 'text', markdown: lines.join('\n') });
    return;
  }
  if (node.tag === 'table') {
    cx.losses.tables += 1;
    emit(cx, { kind: 'text', markdown: tableMarkdown(node, cx) });
    return;
  }
  const hasBlockChild = node.children.some(
    (child) =>
      typeof child !== 'string' &&
      ['div', 'p', 'img', 'ul', 'ol', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(child.tag),
  );
  const todo = todoMark(node);
  if ((!hasBlockChild && !CONTAINERS.has(node.tag)) || todo) {
    const text = clean(node.children.map((child) => inline(child, cx)).join(''));
    if (text !== '' || todo) emit(cx, { kind: 'text', markdown: `${todo ?? ''}${text}`.trimEnd() });
    return;
  }
  // A container: a line of text between its pictures and lists is a block of its own.
  let run: (El | string)[] = [];
  const flush = () => {
    const text = clean(run.map((child) => inline(child, cx)).join(''));
    if (text !== '') emit(cx, { kind: 'text', markdown: text });
    run = [];
  };
  for (const child of node.children) {
    if (typeof child === 'string' || ['span', 'a', 'b', 'i', 'u', 'em', 'strong', 'cite', 'br'].includes(child.tag)) {
      run.push(child);
    } else {
      flush();
      flow(child, cx);
    }
  }
  flush();
}

function emitPending(cx: Context): void {
  cx.blocks.push(...cx.pending);
  cx.pending = [];
}

function titleOf(root: El): string {
  const find = (el: El): string | null => {
    for (const child of el.children) {
      if (typeof child === 'string') continue;
      if (child.tag === 'title') return child.children.filter((one): one is string => typeof one === 'string').join('');
      const inside = find(child);
      if (inside !== null) return inside;
    }
    return null;
  };
  return (find(root) ?? '').replace(/\s+/g, ' ').trim();
}

/** The page's blocks. The title is the page's `<title>`, which is what OneNote shows above the page. */
export function convertPage(html: string): ConvertedPage {
  const root = parse(html);
  const cx: Context = { losses: { tables: 0, attachments: [], ink: 0, other: [] }, blocks: [], pending: [] };
  flow(root, cx);
  emitPending(cx);
  return { title: titleOf(root), blocks: cx.blocks, losses: cx.losses };
}

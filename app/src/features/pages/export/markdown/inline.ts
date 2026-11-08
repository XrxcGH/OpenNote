// Inline OpenNote Markdown (format spec 7.3 to 7.6) to the neutral tree's runs. It follows CommonMark for emphasis,
// code spans, links, images, escapes, and character references, adds `==highlight==` and `~~strike~~`, and reads
// the allowed HTML tags of spec 7.4. Any other raw HTML stays plain text. Reference-style links and footnotes are
// not supported and stay as typed.

import { MARK_ORDER, REPEATABLE_MARKS, isElementId } from '../../../../editor/schema/constants';
import { compareCodePoints } from '../../../../editor/markdown/markOrder';
import { readOpenTag } from '../../../../editor/markdown/tags';
import type { TagMark } from '../../../../editor/markdown/tags';
import type { Inline, Mark } from './tree';

type Wrapper = { readonly t: 'mark'; readonly mark: Mark; readonly children: Node[] };
type Node =
  | { t: 'text'; s: string }
  | { t: 'br' }
  | { t: 'code'; s: string }
  | { t: 'math'; s: string }
  | { t: 'image'; dest: string; alt: string }
  | { t: 'footnote'; id: string }
  | Wrapper
  | { t: 'delim'; ch: string; count: number; canOpen: boolean; canClose: boolean }
  | { t: 'bracket'; image: boolean; active: boolean }
  | { t: 'tag'; name: string; mark: Mark; raw: string; capped?: true };

const ESCAPABLE = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const PUNCT = /[\p{P}\p{S}]/u;
const SPACE = /[\s\p{Zs}]/u;
const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: String.fromCodePoint(0xa0),
  copy: '©',
  reg: '®',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  times: '×',
  deg: '°',
};

const isSpace = (ch: string | undefined): boolean => ch === undefined || SPACE.test(ch);
const isPunct = (ch: string | undefined): boolean => ch !== undefined && PUNCT.test(ch);

function codePoint(n: number): string {
  return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
}

/** The character a reference such as `&amp;` or `&#32;` stands for, with its length, or null. */
function entityAt(src: string, pos: number): { text: string; length: number } | null {
  const m = /^&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([A-Za-z][A-Za-z0-9]{1,31}));/.exec(src.slice(pos, pos + 40));
  if (!m) return null;
  if (m[1] !== undefined) return { text: codePoint(Number(m[1])), length: m[0].length };
  if (m[2] !== undefined) return { text: codePoint(parseInt(m[2], 16)), length: m[0].length };
  const named = ENTITIES[m[3]];
  return named === undefined ? null : { text: named, length: m[0].length };
}

/** Removes backslash escapes and resolves character references, as in link destinations. */
export function unescapeText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const c = raw[i];
    if (c === '\\' && i + 1 < raw.length && ESCAPABLE.includes(raw[i + 1])) {
      out += raw[i + 1];
      i += 1;
    } else if (c === '&') {
      const e = entityAt(raw, i);
      out += e ? e.text : c;
      i += e ? e.length - 1 : 0;
    } else out += c;
  }
  return out;
}

/** The longest opening tag of the grammar: 8 attributes of at most 230 characters each, and the name. */
const MAX_TAG = 1900;
/** R-INL-6: the deepest nesting of tags that reads as marks. A deeper tag stays text. */
const MAX_DEPTH = 32;

const PLAIN: Readonly<Record<string, Mark>> = {
  bold: 'strong',
  italic: 'emphasis',
  subscript: 'sub',
  superscript: 'sup',
};

/** A tag's mark in the neutral form of the inline-v2 fixtures (documents README), which the HTML renderer reads. */
function neutralMark(tag: TagMark): Mark {
  const attrs = tag.attrs;
  switch (tag.type) {
    case 'underline': {
      const line = attrs.line && attrs.line !== 'single' ? { line: attrs.line } : {};
      const color = attrs.color ? { color: attrs.color } : {};
      return 'line' in line || 'color' in color ? { underline: { ...line, ...color } } : 'underline';
    }
    case 'strike':
      return attrs.line === 'double' ? { strike: 'double' } : 'strike';
    case 'highlight':
      return attrs.color ? { highlight: attrs.color } : 'highlight';
    case 'box':
      return { box: { style: attrs.style ?? 'single', ...(attrs.color ? { color: attrs.color } : {}) } };
    case 'foreign':
      return { foreign: attrs.tag ?? '' };
    default: {
      const plain = PLAIN[tag.type];
      if (plain) return plain;
      const [key, value] = Object.entries(attrs)[0] ?? ['', ''];
      return { [key]: value ?? '' } as unknown as Mark;
    }
  }
}

/** The mark and name of an allowed opening tag at the start of `text`, with its length, or null. */
function openTag(text: string): { name: string; mark: Mark; length: number } | null {
  const end = text.slice(0, MAX_TAG).indexOf('>');
  if (end < 0) return null;
  const raw = text.slice(0, end + 1);
  const read = readOpenTag(raw);
  return read ? { name: read.name, mark: neutralMark(read.mark), length: raw.length } : null;
}

/** The text a node stands for if it is not used: delimiters, brackets, and tags come back as typed. */
function nodeToText(node: Node): Node {
  if (node.t === 'delim') return { t: 'text', s: node.ch.repeat(node.count) };
  if (node.t === 'bracket') return { t: 'text', s: node.image ? '![' : '[' };
  if (node.t === 'tag') return { t: 'text', s: node.raw };
  return node;
}

type Delim = Node & { t: 'delim' };

function multipleOfThree(opener: Delim, closer: Delim): boolean {
  const both = opener.canClose || closer.canOpen;
  return both && (opener.count + closer.count) % 3 === 0 && !(opener.count % 3 === 0 && closer.count % 3 === 0);
}

function markOf(ch: string, use: number): Mark {
  if (ch === '~') return 'strike';
  if (ch === '=') return 'highlight';
  return use === 2 ? 'strong' : 'emphasis';
}

/** An item of the doubly linked list that `resolveDelims` works on, so a match costs only the nodes it takes in. */
interface Link {
  node: Node;
  prev: Link | null;
  next: Link | null;
  dead: boolean;
}

/**
 * The kind of a closer for the openers_bottom table of CommonMark: closers of one kind accept the same openers, so
 * when one finds none, no later closer of that kind needs to look below it.
 */
function bottomKey(closer: Delim): string {
  if (closer.ch === '~' || closer.ch === '=') return `${closer.ch}${closer.count >= 2 ? 2 : 1}`;
  return `${closer.ch}${closer.canOpen ? 1 : 0}${closer.count % 3}`;
}

/** The nearest item before `closer` that can open a mark closed by it, stopping at `bottom`, or null. */
function findOpener(closer: Link, bottom: Link | null): Link | null {
  const c = closer.node as Delim;
  const doubled = c.ch === '~' || c.ch === '=';
  for (let o = closer.prev; o !== null && o !== bottom; o = o.prev) {
    const n = o.node;
    if (n.t !== 'delim' || n.ch !== c.ch || !n.canOpen || n.count <= 0) continue;
    if (doubled ? n.count >= 2 && c.count >= 2 : !multipleOfThree(n, c)) return o;
  }
  return null;
}

function unlink(item: Link): void {
  if (item.prev) item.prev.next = item.next;
  if (item.next) item.next.prev = item.prev;
  item.dead = true;
}

/**
 * Matches openers with closers, innermost first, as CommonMark's emphasis rules say. The list and the
 * openers_bottom table keep the work linear: a closer that finds no opener tells every later closer of its kind where
 * not to look, and a match changes only the links it touches.
 */
function resolveDelims(input: Node[]): Node[] {
  if (!input.some((n) => n.t === 'delim')) return input.map(nodeToText);
  const head: Link = { node: { t: 'text', s: '' }, prev: null, next: null, dead: false };
  let tail = head;
  for (const node of input) {
    const item: Link = { node, prev: tail, next: null, dead: false };
    tail.next = item;
    tail = item;
  }
  const bottoms = new Map<string, Link>();
  let closer: Link | null = head.next;
  while (closer !== null) {
    const cn: Node = closer.node;
    if (cn.t !== 'delim' || !cn.canClose || cn.count <= 0) {
      closer = closer.next;
      continue;
    }
    const key = bottomKey(cn);
    const opener = findOpener(closer, bottoms.get(key) ?? null);
    if (opener === null) {
      bottoms.set(key, closer.prev as Link);
      closer = closer.next;
      continue;
    }
    const on = opener.node as Delim;
    const use = cn.ch === '*' || cn.ch === '_' ? (on.count >= 2 && cn.count >= 2 ? 2 : 1) : 2;
    const children: Node[] = [];
    for (let o = opener.next as Link; o !== closer; o = o.next as Link) {
      children.push(nodeToText(o.node));
      o.dead = true;
    }
    const wrapper: Link = {
      node: { t: 'mark', mark: markOf(cn.ch, use), children } satisfies Wrapper,
      prev: opener,
      next: closer,
      dead: false,
    };
    opener.next = wrapper;
    closer.prev = wrapper;
    on.count -= use;
    cn.count -= use;
    const resume = cn.count > 0 ? closer : closer.next;
    if (cn.count <= 0) unlink(closer);
    // A bottom inside the nodes just taken in moves down to the opener, which is no better a place to start from.
    const below = on.count > 0 ? opener : (opener.prev as Link);
    if (on.count <= 0) unlink(opener);
    for (const [k, b] of bottoms) if (b.dead) bottoms.set(k, below);
    closer = resume;
  }
  const out: Node[] = [];
  for (let o = head.next; o !== null; o = o.next) out.push(nodeToText(o.node));
  return out;
}

/** The neutral key of a mark, which is also its kind: a text can hold one mark of each kind (R-MRK-28). */
function kindOf(mark: Mark): string {
  return typeof mark === 'string' ? mark : (Object.keys(mark)[0] ?? '');
}

const valueOf = (mark: Mark): string => (typeof mark === 'string' ? mark : String(Object.values(mark)[0]));

/** The schema's name for a kind of mark, which MARK_ORDER ranks (R-MRK-24). */
const SCHEMA_NAME: Readonly<Record<string, string>> = {
  strong: 'bold',
  emphasis: 'italic',
  color: 'textColor',
  size: 'textSize',
  ins: 'insertion',
  del: 'deletion',
  fmt: 'formatChange',
  style: 'charStyle',
  sub: 'subscript',
  sup: 'superscript',
};
const ORDER = new Map<string, number>(MARK_ORDER.map((name, i) => [name, i]));
const rankOf = (mark: Mark): number => {
  const kind = kindOf(mark);
  return ORDER.get(SCHEMA_NAME[kind] ?? kind) ?? MARK_ORDER.length;
};
const repeatable = (mark: Mark): boolean => REPEATABLE_MARKS.has(SCHEMA_NAME[kindOf(mark)] ?? kindOf(mark));

/**
 * Marks in the nesting order of spec 7.10, outermost first. Of one kind the innermost value wins (R-MRK-28), except
 * comments and foreign marks, which all stay and sort by code point.
 */
function ordered(marks: readonly Mark[]): Mark[] {
  const kept = new Map<string, Mark>();
  for (const mark of marks) {
    const key = repeatable(mark) ? JSON.stringify(mark) : kindOf(mark);
    kept.delete(key);
    kept.set(key, mark);
  }
  return [...kept.values()].sort(
    (a, b) => rankOf(a) - rankOf(b) || (repeatable(a) ? compareCodePoints(valueOf(a), valueOf(b)) : 0),
  );
}

function plain(nodes: readonly Node[]): string {
  return nodes
    .map((n) =>
      n.t === 'text' || n.t === 'code' || n.t === 'math'
        ? n.s
        : n.t === 'mark'
          ? plain(n.children)
          : n.t === 'image'
            ? n.alt
            : n.t === 'footnote'
              ? ''
              : ' ',
    )
    .join('');
}

function flatten(nodes: readonly Node[], marks: readonly Mark[], out: Inline[]): void {
  for (const node of nodes) {
    if (node.t === 'text' && node.s !== '') out.push({ text: node.s, marks: ordered(marks) });
    else if (node.t === 'code') out.push({ text: node.s, marks: ordered([...marks, 'code']) });
    else if (node.t === 'math') out.push({ math: node.s });
    else if (node.t === 'br') out.push({ hardBreak: true });
    else if (node.t === 'image') out.push({ image: node.dest, alt: node.alt });
    else if (node.t === 'footnote') out.push({ footnote: node.id, marks: ordered(marks) });
    else if (node.t === 'mark') flatten(node.children, [...marks, node.mark], out);
  }
}

function merge(runs: readonly Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (last && 'text' in last && 'text' in run && JSON.stringify(last.marks) === JSON.stringify(run.marks)) {
      out[out.length - 1] = { text: last.text + run.text, marks: last.marks };
    } else out.push(run);
  }
  return out;
}

interface Tail {
  readonly dest: string;
  readonly end: number;
}

/** The destination of an inline link, starting just after `(`, and the position after the closing `)`. */
function linkTail(src: string, start: number): Tail | null {
  let pos = start;
  const skip = () => {
    while (pos < src.length && /[ \t\n]/.test(src[pos])) pos += 1;
  };
  skip();
  let dest: string;
  if (src[pos] === '<') {
    const close = /^<((?:[^<>\n\\]|\\.)*)>/.exec(src.slice(pos));
    if (!close) return null;
    dest = unescapeText(close[1]);
    pos += close[0].length;
  } else {
    let depth = 0;
    const from = pos;
    while (pos < src.length && src[pos] > ' ' && src[pos] !== '\u007f' && !/\s/.test(src[pos])) {
      if (src[pos] === '\\' && pos + 1 < src.length) pos += 1;
      else if (src[pos] === '(') depth += 1;
      else if (src[pos] === ')') {
        if (depth === 0) break;
        depth -= 1;
      }
      pos += 1;
    }
    dest = unescapeText(src.slice(from, pos));
  }
  skip();
  const title = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\((?:[^()\\]|\\.)*\))/.exec(src.slice(pos));
  if (title) {
    pos += title[0].length;
    skip();
  }
  return src[pos] === ')' ? { dest, end: pos + 1 } : null;
}

class InlineParser {
  private out: Node[] = [];
  private pos = 0;
  private brackets: number[] = [];
  /** How many tags are open now. */
  private depth = 0;
  /** The tag nodes still open, innermost last, so a closing tag finds its partner at once. */
  private tags: { node: Node; index: number }[] = [];

  constructor(private readonly src: string) {}

  run(): Node[] {
    const src = this.src;
    while (this.pos < src.length) this.step(src[this.pos]);
    return resolveDelims(this.out);
  }

  private text(s: string): void {
    const last = this.out.at(-1);
    if (last?.t === 'text') last.s += s;
    else this.out.push({ t: 'text', s });
  }

  private step(c: string): void {
    if (c === '\\') this.backslash();
    else if (c === '`') this.codeSpan();
    else if (c === '$') this.inlineMath();
    else if (c === '&') this.entity();
    else if (c === '<') this.angle();
    else if (c === '*' || c === '_' || c === '~' || c === '=') this.delimiter(c);
    else if (c === '[' && this.footnote()) return;
    else if (c === '[') this.openBracket(false, 1);
    else if (c === '!' && this.src[this.pos + 1] === '[') this.openBracket(true, 2);
    else if (c === ']') this.closeBracket();
    else if (c === '\n') this.newline();
    else {
      this.text(c);
      this.pos += 1;
    }
  }

  /** `[^ID]`, a reference to a footnote. It reads as one only when the ID is one, and nothing is added to the text. */
  private footnote(): boolean {
    const found = /^\[\^([^\]\s[]{1,64})\]/.exec(this.src.slice(this.pos, this.pos + 70));
    if (!found || !isElementId(found[1])) return false;
    // A reference with a link destination after it is a link whose text starts with a caret.
    const after = this.pos + found[0].length;
    if (this.src[after] === '(' && linkTail(this.src, after + 1)) return false;
    this.out.push({ t: 'footnote', id: found[1] });
    this.pos += found[0].length;
    return true;
  }

  private backslash(): void {
    const next = this.src[this.pos + 1];
    if (next === '\n') {
      this.out.push({ t: 'br' });
      this.pos += 2;
      while (this.src[this.pos] === ' ' || this.src[this.pos] === '\t') this.pos += 1;
    } else if (next !== undefined && ESCAPABLE.includes(next)) {
      this.text(next);
      this.pos += 2;
    } else {
      this.text('\\');
      this.pos += 1;
    }
  }

  /** `$math$`: the opening `$` is followed by a non-space, and the closing one is preceded by a non-space. */
  private inlineMath(): void {
    const src = this.src;
    const from = this.pos + 1;
    const first = src[from];
    if (first !== undefined && !/\s/.test(first) && first !== '$') {
      for (let at = from; at < src.length; at += 1) {
        if (src[at] === '\n') break;
        if (src[at] === '\\') at += 1;
        else if (src[at] === '$' && !/\s/.test(src[at - 1] ?? ' ') && at > from) {
          this.out.push({ t: 'math', s: src.slice(from, at) });
          this.pos = at + 1;
          return;
        }
      }
    }
    this.text('$');
    this.pos += 1;
  }

  private codeSpan(): void {
    const src = this.src;
    let n = 0;
    while (src[this.pos + n] === '`') n += 1;
    const from = this.pos + n;
    let at = from;
    for (;;) {
      const open = src.indexOf('`', at);
      if (open < 0) {
        this.text('`'.repeat(n));
        this.pos = from;
        return;
      }
      let run = 0;
      while (src[open + run] === '`') run += 1;
      if (run === n) {
        let body = src.slice(from, open).replace(/\n/g, ' ');
        if (body.startsWith(' ') && body.endsWith(' ') && body.trim() !== '') body = body.slice(1, -1);
        this.out.push({ t: 'code', s: body });
        this.pos = open + n;
        return;
      }
      at = open + run;
    }
  }

  private entity(): void {
    const e = entityAt(this.src, this.pos);
    this.text(e ? e.text : '&');
    this.pos += e ? e.length : 1;
  }

  private angle(): void {
    const rest = this.src.slice(this.pos);
    const open = openTag(rest);
    if (open) {
      // R-INL-6: past the cap a tag is text, and so is the closing tag that would have paired with it.
      const capped = this.depth >= MAX_DEPTH;
      if (!capped) this.depth += 1;
      const node: Node = {
        t: 'tag',
        name: open.name,
        mark: open.mark,
        raw: rest.slice(0, open.length),
        ...(capped ? { capped: true as const } : {}),
      };
      this.tags.push({ node, index: this.out.length });
      this.out.push(node);
      this.pos += open.length;
      return;
    }
    const close = /^<\/(u|sub|sup|em|strong|del|mark|span|ins|s)>/.exec(rest);
    if (close && this.closeTag(close[1])) {
      this.pos += close[0].length;
      return;
    }
    const br = /^<br\s*\/?>/i.exec(rest);
    const auto = /^<([A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*)>/.exec(rest);
    if (br) this.out.push({ t: 'br' });
    else if (auto) this.out.push({ t: 'mark', mark: { link: auto[1] }, children: [{ t: 'text', s: auto[1] }] });
    else {
      this.text('<');
      this.pos += 1;
      return;
    }
    this.pos += (br ?? auto)![0].length;
  }

  private closeTag(name: string): boolean {
    // A link's text can swallow tags that were still open, so a tag whose node is gone no longer counts.
    while (this.tags.length > 0) {
      const last = this.tags[this.tags.length - 1];
      if (this.out[last.index] === last.node) break;
      this.tags.pop();
    }
    const top = this.tags[this.tags.length - 1];
    const k = top ? top.index : -1;
    const node = this.out[k];
    if (node?.t !== 'tag' || node.name !== name) return false;
    if (node.capped) {
      this.out[k] = { t: 'text', s: node.raw };
      this.tags.pop();
      return false;
    }
    this.tags.pop();
    const inside = this.out.splice(k + 1);
    this.depth -= 1;
    const children = resolveDelims(inside);
    this.out.pop();
    this.out.push({ t: 'mark', mark: node.mark, children });
    return true;
  }

  private delimiter(c: string): void {
    const src = this.src;
    let n = 0;
    while (src[this.pos + n] === c) n += 1;
    const before = src[this.pos - 1];
    const after = src[this.pos + n];
    const left = !isSpace(after) && (!isPunct(after) || isSpace(before) || isPunct(before));
    const right = !isSpace(before) && (!isPunct(before) || isSpace(after) || isPunct(after));
    this.pos += n;
    if ((c === '~' || c === '=') && n < 2) return this.text(c.repeat(n));
    if (c === '=') this.out.push({ t: 'delim', ch: c, count: n, canOpen: !isSpace(after), canClose: !isSpace(before) });
    else if (c === '_') {
      this.out.push({
        t: 'delim',
        ch: c,
        count: n,
        canOpen: left && (!right || isPunct(before)),
        canClose: right && (!left || isPunct(after)),
      });
    } else this.out.push({ t: 'delim', ch: c, count: n, canOpen: left, canClose: right });
  }

  private openBracket(image: boolean, width: number): void {
    this.brackets.push(this.out.length);
    this.out.push({ t: 'bracket', image, active: true });
    this.pos += width;
  }

  private closeBracket(): void {
    const index = this.brackets.pop();
    const opener = index === undefined ? undefined : this.out[index];
    if (index === undefined || opener?.t !== 'bracket') {
      this.text(']');
      this.pos += 1;
      return;
    }
    const tail = opener.active && this.src[this.pos + 1] === '(' ? linkTail(this.src, this.pos + 2) : null;
    if (!tail) {
      this.out[index] = { t: 'text', s: opener.image ? '![' : '[' };
      this.text(']');
      this.pos += 1;
      return;
    }
    const inner = resolveDelims(this.out.splice(index + 1));
    this.out.pop();
    if (opener.image) this.out.push({ t: 'image', dest: tail.dest, alt: plain(inner).replace(/\s+/g, ' ') });
    else {
      this.out.push({ t: 'mark', mark: { link: tail.dest }, children: inner });
      for (const k of this.brackets) {
        const b = this.out[k];
        if (b?.t === 'bracket' && !b.image) b.active = false;
      }
    }
    this.pos = tail.end;
  }

  private newline(): void {
    const last = this.out.at(-1);
    const hard = last?.t === 'text' && / {2,}$/.test(last.s);
    if (last?.t === 'text') last.s = last.s.replace(/ +$/, '');
    this.pos += 1;
    while (this.src[this.pos] === ' ' || this.src[this.pos] === '\t') this.pos += 1;
    if (hard) this.out.push({ t: 'br' });
    else this.text(' ');
  }
}

/** Parses the inline Markdown of one paragraph, heading, or table cell into runs. */
export function parseInline(src: string): Inline[] {
  const runs: Inline[] = [];
  flatten(new InlineParser(src).run(), [], runs);
  // R-WS-2: a hard break at the start or end of a paragraph shows nothing, so it is not kept.
  while ('hardBreak' in (runs[0] ?? {})) runs.shift();
  while ('hardBreak' in (runs.at(-1) ?? {})) runs.pop();
  return merge(runs);
}

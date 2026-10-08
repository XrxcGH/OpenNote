// Inline OpenNote Markdown (format spec 7.3 to 7.6) to the neutral tree's runs. It follows CommonMark for emphasis,
// code spans, links, images, escapes, and character references, adds `==highlight==` and `~~strike~~`, and reads
// the allowed HTML tags of spec 7.4. Any other raw HTML stays plain text. Reference-style links and footnotes are
// not supported and stay as typed.

import type { Inline, Mark } from './tree';

type Wrapper = { readonly t: 'mark'; readonly mark: Mark; readonly children: Node[] };
type Node =
  | { t: 'text'; s: string }
  | { t: 'br' }
  | { t: 'code'; s: string }
  | { t: 'math'; s: string }
  | { t: 'image'; dest: string; alt: string }
  | Wrapper
  | { t: 'delim'; ch: string; count: number; canOpen: boolean; canClose: boolean }
  | { t: 'bracket'; image: boolean; active: boolean }
  | { t: 'tag'; name: string; mark: Mark; raw: string };

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

const COLOR = /^(?:#[0-9a-fA-F]{6}|[A-Za-z][A-Za-z0-9-]{0,31})$/;
const HIGHLIGHTERS = ['honey', 'mint', 'rose', 'apricot', 'lilac'];
const SIZES = ['small', 'large', 'xlarge'];
const PLAIN_TAGS: Readonly<Record<string, Mark>> = {
  u: 'underline',
  sub: 'sub',
  sup: 'sup',
  em: 'emphasis',
  strong: 'strong',
  del: 'strike',
  mark: 'highlight',
};

/** The mark and name of an allowed opening tag at the start of `text`, with its length, or null. */
function openTag(text: string): { name: string; mark: Mark; length: number } | null {
  const plain = /^<(u|sub|sup|em|strong|del|mark)>/.exec(text);
  if (plain) return { name: plain[1], mark: PLAIN_TAGS[plain[1]], length: plain[0].length };
  const attr = /^<(mark|span) data-(color|size)="([^"<>]*)">/.exec(text);
  if (!attr) return null;
  const [raw, name, kind, value] = attr;
  if (kind === 'size' && name === 'span' && SIZES.includes(value))
    return { name, mark: { size: value }, length: raw.length };
  if (kind === 'color' && name === 'span' && COLOR.test(value))
    return { name, mark: { color: value }, length: raw.length };
  if (kind === 'color' && name === 'mark' && HIGHLIGHTERS.includes(value)) {
    return { name, mark: value === 'honey' ? 'highlight' : { highlight: value }, length: raw.length };
  }
  return null;
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

/** The nearest delimiter before `at` that can open a mark closed by `closer`, or -1. */
function findOpener(nodes: readonly Node[], at: number, closer: Delim): number {
  const doubled = closer.ch === '~' || closer.ch === '=';
  for (let j = at - 1; j >= 0; j -= 1) {
    const o = nodes[j];
    if (o.t !== 'delim' || o.ch !== closer.ch || !o.canOpen || o.count <= 0) continue;
    if (doubled ? o.count >= 2 && closer.count >= 2 : !multipleOfThree(o, closer)) return j;
  }
  return -1;
}

/** Matches openers with closers, innermost first, as CommonMark's emphasis rules say. */
function resolveDelims(input: Node[]): Node[] {
  const nodes = [...input];
  let i = 0;
  while (i < nodes.length) {
    const closer = nodes[i];
    if (closer.t !== 'delim' || !closer.canClose) {
      i += 1;
      continue;
    }
    const found = findOpener(nodes, i, closer);
    if (found < 0) {
      i += 1;
      continue;
    }
    const opener = nodes[found] as Delim;
    const use = closer.ch === '*' || closer.ch === '_' ? (opener.count >= 2 && closer.count >= 2 ? 2 : 1) : 2;
    const children = nodes.slice(found + 1, i).map(nodeToText);
    const wrapper: Wrapper = { t: 'mark', mark: markOf(closer.ch, use), children };
    opener.count -= use;
    closer.count -= use;
    const keepOpener = opener.count > 0;
    const keepCloser = closer.count > 0;
    nodes.splice(found + 1, i - found - 1, wrapper);
    i = found + 2;
    if (!keepCloser) {
      nodes.splice(i, 1);
    }
    if (!keepOpener) {
      nodes.splice(found, 1);
      i -= 1;
    }
  }
  return nodes.map(nodeToText);
}

const RANK = ['link', 'strong', 'emphasis', 'strike', 'underline', 'highlight', 'color', 'size', 'sub', 'sup', 'code'];

function rankOf(mark: Mark): number {
  return RANK.indexOf(
    typeof mark === 'string'
      ? mark
      : 'link' in mark
        ? 'link'
        : 'highlight' in mark
          ? 'highlight'
          : 'color' in mark
            ? 'color'
            : 'size',
  );
}

/** Marks in the nesting order of spec 7.7, outermost first, each once. */
function ordered(marks: readonly Mark[]): Mark[] {
  const seen = new Set<string>();
  const unique = marks.filter((m) => !seen.has(JSON.stringify(m)) && seen.add(JSON.stringify(m)));
  return unique
    .map((m, i) => ({ m, i }))
    .sort((a, b) => rankOf(a.m) - rankOf(b.m) || a.i - b.i)
    .map((x) => x.m);
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
    else if (c === '[') this.openBracket(false, 1);
    else if (c === '!' && this.src[this.pos + 1] === '[') this.openBracket(true, 2);
    else if (c === ']') this.closeBracket();
    else if (c === '\n') this.newline();
    else {
      this.text(c);
      this.pos += 1;
    }
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
      this.out.push({ t: 'tag', name: open.name, mark: open.mark, raw: rest.slice(0, open.length) });
      this.pos += open.length;
      return;
    }
    const close = /^<\/(u|sub|sup|em|strong|del|mark|span)>/.exec(rest);
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
    for (let k = this.out.length - 1; k >= 0; k -= 1) {
      const node = this.out[k];
      if (node.t === 'tag' && node.name === name) {
        const children = resolveDelims(this.out.splice(k + 1));
        this.out.pop();
        this.out.push({ t: 'mark', mark: node.mark, children });
        return true;
      }
    }
    return false;
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
  return merge(runs);
}

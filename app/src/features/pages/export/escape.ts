// Escaping text as OpenNote Markdown (format spec 7.6) and the links inside Markdown (spec 7.5 and 11.1). The
// escaping is a port of the Rust writer and passes the same shared fixtures.

const WORD = /[\p{L}\p{N}]/u;
const isWord = (c: string | undefined): boolean => c !== undefined && WORD.test(c);
const isDigit = (c: string): boolean => c >= '0' && c <= '9';

interface Context {
  readonly first: boolean;
  readonly last: boolean;
  readonly before: string | undefined;
  readonly after: string | undefined;
  /** The whole text, and where this character is in it, so a check can read ahead without copying. */
  readonly chars: readonly string[];
  readonly index: number;
  readonly afterDigits: boolean;
}

/**
 * True when the characters after the `&` at `at` make a character reference: an optional `#`, letters or digits, then
 * `;`. It reads in place, so escaping stays linear in the length of the text.
 */
function isReference(chars: readonly string[], at: number): boolean {
  const start = chars[at + 1] === '#' ? at + 2 : at + 1;
  let n = start;
  while (n < chars.length && /[A-Za-z0-9]/.test(chars[n])) n += 1;
  return n > start && chars[n] === ';';
}

const ALWAYS = new Set(['\\', '`', '*', '~', '$', '[', ']', '{', '<', '|']);

function escapedChar(c: string, cx: Context): string {
  if (c === '\0') return '�';
  if (c === '\t') return '&#9;';
  if (c === ' ' && (cx.first || cx.last)) return '&#32;';
  if (ALWAYS.has(c)) return `\\${c}`;
  if (c === '_' && !(isWord(cx.before) && isWord(cx.after))) return '\\_';
  if (c === '=' && (cx.first || cx.before === '=' || cx.after === '=')) return '\\=';
  if (c === '&' && isReference(cx.chars, cx.index)) return '\\&';
  if (c === '#' && (cx.before === undefined || /\s/.test(cx.before))) return '\\#';
  if ((c === '>' || c === '-' || c === '+') && cx.first) return `\\${c}`;
  if ((c === '.' || c === ')') && cx.afterDigits) return `\\${c}`;
  return c;
}

/**
 * Escapes text as spec 7.6 requires. `atLineStart` says whether the text begins a paragraph line. A line feed becomes
 * a hard break, and the text after it begins a new paragraph line.
 */
export function escapeText(text: string, atLineStart: boolean): string {
  const chars = Array.from(text.replace(/\r\n?/g, '\n'));
  let out = '';
  let lineStart = atLineStart;
  let digits: number | null = atLineStart ? 0 : null;
  chars.forEach((c, i) => {
    if (c === '\n') {
      out += '\\\n';
      lineStart = true;
      digits = 0;
      return;
    }
    const first = lineStart;
    lineStart = false;
    const before = digits ?? 0;
    digits = digits !== null && isDigit(c) ? digits + 1 : null;
    const after = chars[i + 1];
    out += escapedChar(c, {
      first,
      last: after === undefined || after === '\n',
      before: chars[i - 1],
      after,
      chars,
      index: i,
      afterDigits: before >= 1 && before <= 9 && digits === null,
    });
  });
  return out;
}

/** Text for a single line, such as a heading or a list item: line breaks become spaces. */
export function oneLine(text: string): string {
  return text.replace(/\r\n|[\r\n]/g, ' ');
}

/** A destination as spec 7.5 writes it: bare when it can be, otherwise between `<` and `>`. */
export function writeDestination(destination: string): string {
  // eslint-disable-next-line no-control-regex -- control characters make a destination unsafe to write bare
  const bare = destination !== '' && !/[\s\u0000-\u001f\u007f()<>\\]/.test(destination);
  return bare ? destination : `<${destination.replace(/[<>\\]/g, (c) => `\\${c}`)}>`;
}

export interface LinkRewriter {
  /** The relative path to another page's Markdown, or null to keep the link. */
  readonly page: (pageId: string) => string | null;
  /** The path of an asset, or null to keep the link. */
  readonly asset: (assetId: string) => string | null;
}

interface Found {
  readonly start: number;
  readonly end: number;
  readonly destination: string;
}

/** The destination after `](` at `at`: its span in the line and its text without backslash escapes. */
function destinationAt(line: string, at: number): { end: number; text: string; start: number } | null {
  let i = at;
  while (line[i] === ' ' || line[i] === '\t') i += 1;
  const start = i;
  let text = '';
  if (line[i] === '<') {
    for (i += 1; i < line.length; i += 1) {
      const c = line[i];
      if (c === '\\') {
        i += 1;
        text += line[i] ?? '';
      } else if (c === '>') return { start, end: i + 1, text };
      else if (c === '<' || c === '\n') return null;
      else text += c;
    }
    return null;
  }
  let depth = 0;
  for (; i < line.length; i += 1) {
    const c = line[i];
    if (c === '\\') {
      i += 1;
      text += line[i] ?? '';
    } else if (c === '(') {
      depth += 1;
      text += c;
    } else if (c === ')' && depth === 0) return { start, end: i, text };
    else if (c === ')') {
      depth -= 1;
      text += c;
    } else if (/\s/.test(c)) return { start, end: i, text };
    else text += c;
  }
  return null;
}

function codeSpanEnd(line: string, at: number): number {
  let run = 0;
  while (line[at + run] === '`') run += 1;
  let i = at + run;
  while (i < line.length) {
    let len = 0;
    while (line[i + len] === '`') len += 1;
    if (len === run) return i + len;
    i += Math.max(len, 1);
  }
  return at + run;
}

function scanLine(line: string, offset: number, found: Found[]): void {
  let open = 0;
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    if (c === '\\') i += 2;
    else if (c === '`') i = codeSpanEnd(line, i);
    else if (c === '[') {
      open += 1;
      i += 1;
    } else if (c === ']' && (open === 0 || line[i + 1] !== '(')) {
      open = Math.max(0, open - 1);
      i += 1;
    } else if (c === ']') {
      open -= 1;
      const dest = destinationAt(line, i + 2);
      if (dest) found.push({ start: offset + dest.start, end: offset + dest.end, destination: dest.text });
      i = dest ? dest.end : i + 2;
    } else i += 1;
  }
}

/** The fence character and length when a line opens or closes a code fence. */
function fenceMarker(line: string): [string, number] | null {
  const content = line.replace(/^[ >\t]+/, '');
  const c = content[0];
  if (c !== '`' && c !== '~') return null;
  let run = 0;
  while (content[run] === c) run += 1;
  return run >= 3 ? [c, run] : null;
}

/** Every inline link destination in the Markdown, outside code. */
function findLinks(markdown: string): Found[] {
  const found: Found[] = [];
  let offset = 0;
  let fence: [string, number] | null = null;
  for (const line of markdown.split(/(?<=\n)/)) {
    const marker = fenceMarker(line);
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker[1] >= fence[1]) fence = null;
    } else if (!fence) scanLine(line, offset, found);
    offset += line.length;
  }
  return found;
}

/**
 * Rewrites page and asset links into the paths an export uses (spec 11.1). Links the rewriter doesn't know stay as
 * they are. A page link's fragment is dropped, because a readable copy has no element anchors.
 */
export function rewriteLinks(markdown: string, rewrite: LinkRewriter): string {
  let out = '';
  let copied = 0;
  for (const link of findLinks(markdown)) {
    const page = /^opennote:page\/([^#]+)/.exec(link.destination);
    const asset = /^asset:(.+)$/.exec(link.destination);
    const target = page ? rewrite.page(page[1]) : asset ? rewrite.asset(asset[1]) : null;
    if (target === null) continue;
    out += markdown.slice(copied, link.start) + writeDestination(target);
    copied = link.end;
  }
  return out + markdown.slice(copied);
}

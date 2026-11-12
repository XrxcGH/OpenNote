// ANSI colors in the console (DESIGN 5.1). A program's output may carry Select Graphic Rendition sequences, the
// "ESC [ params m" control sequence of ECMA-48 (section 8.3.117). The console keeps the ones it can draw: reset (0),
// bold (1), normal intensity (22), the eight foreground colors (30 to 37), default foreground (39), and the eight
// bright foreground colors (90 to 97, the aixterm extension every terminal reads). Every other control sequence and
// every other SGR parameter is removed, so no escape byte ever reaches the page as text.

/** A foreground color: 0 to 7 for 30 to 37, 8 to 15 for 90 to 97. */
export type AnsiColor = number;

export interface AnsiStyle {
  fg: AnsiColor | null;
  bold: boolean;
}

export interface AnsiSpan extends AnsiStyle {
  text: string;
}

export const PLAIN: AnsiStyle = { fg: null, bold: false };

const ESC = '\u001b';
const BEL = '\u0007';
/** A control sequence longer than this is not one: it is dropped to the end of its line. */
const MAX_SEQUENCE = 64;

/** Applies one SGR parameter list (ECMA-48 8.3.117) to a style. Unknown parameters change nothing. */
export function applySgr(style: AnsiStyle, params: string): AnsiStyle {
  let { fg, bold } = style;
  const values = params === '' ? [0] : params.split(/[;:]/).map((part) => (part === '' ? 0 : Number(part)));
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === 0) {
      fg = null;
      bold = false;
    } else if (value === 1) bold = true;
    else if (value === 22) bold = false;
    else if (value >= 30 && value <= 37) fg = value - 30;
    else if (value === 39) fg = null;
    else if (value >= 90 && value <= 97) fg = value - 90 + 8;
    else if (value === 38 || value === 48 || value === 58) {
      // An extended color (ITU T.416): 5;n or 2;r;g;b. Its numbers are not parameters of their own.
      const mode = values[index + 1];
      index += mode === 5 ? 2 : mode === 2 ? 4 : 1;
    }
  }
  return { fg, bold };
}

/**
 * Reads output that arrives in pieces: a sequence cut between two pieces is kept until the rest comes. The style
 * carries from one piece to the next, as a terminal's does.
 */
export class AnsiParser {
  style: AnsiStyle = PLAIN;
  private pending = '';

  reset(): void {
    this.style = PLAIN;
    this.pending = '';
  }

  /** Reads the next piece. `final` marks the last one: a sequence still cut short then is dropped as too long. */
  push(chunk: string, final = false): AnsiSpan[] {
    const text = this.pending + chunk;
    this.pending = '';
    const spans: AnsiSpan[] = [];
    let plain = '';
    const flush = () => {
      if (!plain) return;
      const last = spans[spans.length - 1];
      if (last && last.fg === this.style.fg && last.bold === this.style.bold) last.text += plain;
      else spans.push({ text: plain, ...this.style });
      plain = '';
    };
    let index = 0;
    while (index < text.length) {
      const char = text[index]!;
      if (char !== ESC) {
        // Carriage returns and other control characters (C0, except tab and line feed) are not drawn.
        const code = char.charCodeAt(0);
        if (code >= 32 || char === '\n' || char === '\t') plain += char;
        index += 1;
        continue;
      }
      const end = this.sequenceEnd(text, index);
      if (end === null) {
        // Cut short: wait for the next piece, unless it is too long to be a sequence or no piece follows.
        if (!final && text.length - index <= MAX_SEQUENCE) {
          this.pending = text.slice(index);
          break;
        }
        // Not a sequence: it is dropped to the end of its line, and the lines after it are kept.
        const lineEnd = text.indexOf('\n', index);
        if (lineEnd === -1) break;
        index = lineEnd;
        continue;
      }
      const sequence = text.slice(index, end);
      if (sequence[1] === '[' && sequence.endsWith('m')) {
        flush();
        this.style = applySgr(this.style, sequence.slice(2, -1));
      }
      index = end;
    }
    flush();
    return spans;
  }

  /** Where the escape sequence at `start` ends (exclusive), or null when the text stops first. */
  private sequenceEnd(text: string, start: number): number | null {
    const kind = text[start + 1];
    if (kind === undefined) return null;
    if (kind === '[') {
      // CSI: parameter bytes 0x30 to 0x3F, intermediate bytes 0x20 to 0x2F, one final byte 0x40 to 0x7E.
      for (let index = start + 2; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) return index + 1;
        if (code < 0x20 || code > 0x3f) return index;
      }
      return null;
    }
    if (kind === ']' || kind === 'P' || kind === '_' || kind === '^' || kind === 'X') {
      // OSC and the other string commands end at BEL or at ST (ESC \).
      for (let index = start + 2; index < text.length; index += 1) {
        if (text[index] === BEL) return index + 1;
        if (text[index] === ESC && text[index + 1] === '\\') return index + 2;
        if (text[index] === ESC && index + 1 === text.length) return null;
      }
      return null;
    }
    // Any other escape is ESC and one byte.
    return start + 2;
  }
}

/** The spans of one whole text. */
export function parseAnsi(text: string): AnsiSpan[] {
  return new AnsiParser().push(text, true);
}

/** The text with every escape sequence removed, for copying and for Insert into page. */
export function stripAnsi(text: string): string {
  return parseAnsi(text)
    .map((span) => span.text)
    .join('');
}

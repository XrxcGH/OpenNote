// A small reader for the objects of a PDF file: names, numbers, strings, arrays, dictionaries, references, and streams.
// It reads what Chromium and other PDF writers produce for a printed page, which has plain objects and a cross-reference
// table. It finds objects by scanning for `n g obj`, so it also reads files whose table is damaged. Streams that use
// object streams or encryption are not read.

export type PdfValue = null | boolean | number | PdfName | PdfString | PdfRef | readonly PdfValue[] | PdfDict;

export class PdfName {
  constructor(readonly name: string) {}
}

export class PdfString {
  constructor(readonly bytes: Uint8Array) {}

  /** The text, read as UTF-16 when it starts with a byte order mark and as Latin-1 otherwise. */
  get text(): string {
    const b = this.bytes;
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) {
      let out = '';
      for (let i = 2; i + 1 < b.length; i += 2) out += String.fromCharCode((b[i] << 8) | b[i + 1]);
      return out;
    }
    return Array.from(b, (c) => String.fromCharCode(c)).join('');
  }
}

export class PdfRef {
  constructor(readonly num: number) {}
}

export interface PdfDict {
  readonly [key: string]: PdfValue;
}

export interface PdfObject {
  readonly value: PdfValue;
  /** The raw stream data, if the object is a stream. */
  readonly stream?: Uint8Array;
}

/** Byte classes, looked up by byte value, so the reader needs no string for each byte it reads. */
const WHITESPACE = new Uint8Array(256);
for (const b of [0, 9, 10, 12, 13, 32]) WHITESPACE[b] = 1;
const DELIMITERS = new Uint8Array(256);
for (const c of '()<>[]{}/%') DELIMITERS[c.charCodeAt(0)] = 1;

const isDigit = (b: number): boolean => b >= 0x30 && b <= 0x39;
const isAlnum = (b: number): boolean => isDigit(b) || (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
/** A byte that can start a number: a digit, a sign, or a point. */
const startsNumber = (b: number): boolean => isDigit(b) || b === 0x2b || b === 0x2d || b === 0x2e;
const nibble = (b: number): number =>
  b >= 0x30 && b <= 0x39 ? b - 0x30 : b >= 0x61 && b <= 0x66 ? b - 0x57 : b >= 0x41 && b <= 0x46 ? b - 0x37 : -1;
const ESCAPES: Readonly<Record<number, number>> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };

const isName = (v: PdfValue | undefined, name?: string): v is PdfName =>
  v instanceof PdfName && (name === undefined || v.name === name);

export class Lexer {
  pos: number;

  constructor(
    readonly bytes: Uint8Array,
    start = 0,
  ) {
    this.pos = start;
  }

  private char(at = this.pos): string {
    return String.fromCharCode(this.bytes[at]);
  }

  skip(): void {
    while (this.pos < this.bytes.length) {
      const b = this.bytes[this.pos];
      if (WHITESPACE[b] === 1) this.pos += 1;
      else if (b === 0x25) {
        while (this.pos < this.bytes.length && this.bytes[this.pos] !== 10 && this.bytes[this.pos] !== 13)
          this.pos += 1;
      } else break;
    }
  }

  get done(): boolean {
    this.skip();
    return this.pos >= this.bytes.length;
  }

  /** The next word that is not a value, such as an operator in a content stream or the keyword `R`. */
  private word(): string {
    const start = this.wordEnd();
    let out = '';
    for (let i = start; i < this.pos; i += 1) out += String.fromCharCode(this.bytes[i]);
    return out;
  }

  /** Moves past the word at the position and returns where it started. */
  private wordEnd(): number {
    const start = this.pos;
    const { bytes } = this;
    while (this.pos < bytes.length && WHITESPACE[bytes[this.pos]] !== 1 && DELIMITERS[bytes[this.pos]] !== 1) {
      this.pos += 1;
    }
    return start;
  }

  /** A keyword or operator: any bare word that is not a number, boolean, or null. Returns null at a value. */
  operator(): string | null {
    this.skip();
    const at = this.pos;
    if (this.pos >= this.bytes.length) return null;
    const c = this.bytes[this.pos];
    if (DELIMITERS[c] === 1 || startsNumber(c)) return null;
    const w = this.word();
    if (w === 'true' || w === 'false' || w === 'null') {
      this.pos = at;
      return null;
    }
    return w;
  }

  private literal(): PdfString {
    const out: number[] = [];
    let depth = 1;
    this.pos += 1;
    while (this.pos < this.bytes.length && depth > 0) {
      const b = this.bytes[this.pos++];
      if (b === 0x5c) {
        const n = this.bytes[this.pos++];
        if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30;
          for (let k = 0; k < 2 && this.bytes[this.pos] >= 0x30 && this.bytes[this.pos] <= 0x37; k += 1) {
            v = v * 8 + this.bytes[this.pos++] - 0x30;
          }
          out.push(v & 255);
        } else if (n === 10 || n === 13) {
          if (n === 13 && this.bytes[this.pos] === 10) this.pos += 1;
        } else out.push(ESCAPES[n] ?? n);
      } else if (b === 0x28) {
        depth += 1;
        out.push(b);
      } else if (b === 0x29) {
        depth -= 1;
        if (depth > 0) out.push(b);
      } else out.push(b);
    }
    return new PdfString(Uint8Array.from(out));
  }

  private hex(): PdfString {
    const digits: number[] = [];
    this.pos += 1;
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 0x3e) {
      const d = nibble(this.bytes[this.pos]);
      if (d >= 0) digits.push(d);
      this.pos += 1;
    }
    this.pos += 1;
    if (digits.length % 2 === 1) digits.push(0);
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = digits[2 * i] * 16 + digits[2 * i + 1];
    return new PdfString(out);
  }

  private name(): PdfName {
    this.pos += 1;
    const raw = this.word();
    return new PdfName(raw.replace(/#([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))));
  }

  /** The next value, or undefined at an operator or the end of the data. */
  value(): PdfValue | undefined {
    this.skip();
    if (this.pos >= this.bytes.length) return undefined;
    const c = this.char();
    if (c === '/') return this.name();
    if (c === '(') return this.literal();
    if (c === '<' && this.char(this.pos + 1) === '<') return this.dict();
    if (c === '<') return this.hex();
    if (c === '[') return this.array();
    if (c === ']' || c === '>' || c === ')' || c === '{' || c === '}') return undefined;
    const at = this.pos;
    const first = this.bytes[at];
    if (!startsNumber(first)) {
      // Only t, f, and n can start a keyword value. Any other word is an operator, left for the caller.
      if (first !== 0x74 && first !== 0x66 && first !== 0x6e) return undefined;
      const w = this.word();
      if (w === 'true') return true;
      if (w === 'false') return false;
      if (w === 'null') return null;
      this.pos = at;
      return undefined;
    }
    this.wordEnd();
    const n = this.numeric(at, this.pos);
    if (n === undefined) {
      this.pos = at;
      return undefined;
    }
    return Number.isInteger(n) && first !== 0x2b && first !== 0x2d && !this.hasPoint(at) ? this.numberOrRef(n) : n;
  }

  private hasPoint(start: number): boolean {
    for (let i = start; i < this.pos; i += 1) if (this.bytes[i] === 0x2e) return true;
    return false;
  }

  /** The value of the plain number in bytes `from` to `to` (a sign, digits, one point), or undefined if it isn't one. */
  private numeric(from: number, to: number): number | undefined {
    const { bytes } = this;
    let i = from;
    if (bytes[i] === 0x2b || bytes[i] === 0x2d) i += 1;
    let digits = 0;
    let int = 0;
    while (i < to && isDigit(bytes[i])) {
      int = int * 10 + bytes[i] - 0x30;
      digits += 1;
      i += 1;
    }
    let point = false;
    if (i < to && bytes[i] === 0x2e) {
      point = true;
      i += 1;
      while (i < to && isDigit(bytes[i])) {
        digits += 1;
        i += 1;
      }
    }
    if (i !== to || digits === 0) return undefined;
    if (!point && digits < 16) return bytes[from] === 0x2d ? -int : int;
    let text = '';
    for (let k = from; k < to; k += 1) text += String.fromCharCode(bytes[k]);
    return Number(text);
  }

  /** An unsigned whole number may be the first part of a reference, `n g R`. */
  private numberOrRef(n: number): PdfValue {
    const save = this.pos;
    this.skip();
    const { bytes } = this;
    let end = this.pos;
    while (end < bytes.length && end < this.pos + 8 && isDigit(bytes[end])) end += 1;
    if (end > this.pos) {
      this.pos = end;
      this.skip();
      if (bytes[this.pos] === 0x52 && !(this.pos + 1 < bytes.length && isAlnum(bytes[this.pos + 1]))) {
        this.pos += 1;
        return new PdfRef(n);
      }
    }
    this.pos = save;
    return n;
  }

  private array(): PdfValue[] {
    const out: PdfValue[] = [];
    this.pos += 1;
    for (;;) {
      this.skip();
      if (this.pos >= this.bytes.length) return out;
      if (this.char() === ']') {
        this.pos += 1;
        return out;
      }
      const v = this.value();
      if (v === undefined) this.pos += 1;
      else out.push(v);
    }
  }

  private dict(): PdfDict {
    const out: Record<string, PdfValue> = {};
    this.pos += 2;
    for (;;) {
      this.skip();
      if (this.pos >= this.bytes.length) return out;
      if (this.char() === '>' && this.char(this.pos + 1) === '>') {
        this.pos += 2;
        return out;
      }
      const key = this.value();
      if (!isName(key)) {
        this.pos += 1;
        continue;
      }
      const v = this.value();
      out[key.name] = v === undefined ? null : v;
    }
  }
}

const find = (bytes: Uint8Array, text: string, from: number): number => {
  outer: for (let i = from; i <= bytes.length - text.length; i += 1) {
    for (let k = 0; k < text.length; k += 1) if (bytes[i + k] !== text.charCodeAt(k)) continue outer;
    return i;
  }
  return -1;
};

/** Every indirect object in the file, by number. */
export function readObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const text = new TextDecoder('latin1').decode(bytes);
  const objects = new Map<number, PdfObject>();
  const header = /(?:^|[\r\n])(\d+) (\d+) obj\b/g;
  for (let m = header.exec(text); m; m = header.exec(text)) {
    const start = m.index + m[0].length;
    const lexer = new Lexer(bytes, start);
    const value = lexer.value();
    if (value === undefined) continue;
    lexer.skip();
    let stream: Uint8Array | undefined;
    if (find(bytes.subarray(lexer.pos, lexer.pos + 8), 'stream', 0) === 0) {
      let from = lexer.pos + 6;
      if (bytes[from] === 13) from += 1;
      if (bytes[from] === 10) from += 1;
      const declared =
        value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof PdfName)
          ? (value as PdfDict).Length
          : undefined;
      let end = typeof declared === 'number' ? from + declared : -1;
      if (end < 0 || find(bytes.subarray(end, end + 16), 'endstream', 0) < 0) end = find(bytes, 'endstream', from);
      stream = bytes.subarray(from, end < 0 ? bytes.length : end);
      // The data of a stream is not objects. Skipping it saves scanning it, and stops it from being read as one.
      header.lastIndex = Math.max(header.lastIndex, end < 0 ? bytes.length : end);
    }
    objects.set(Number(m[1]), { value, stream });
  }
  return objects;
}

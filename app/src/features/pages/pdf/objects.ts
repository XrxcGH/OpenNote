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

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set(['(', ')', '<', '>', '[', ']', '{', '}', '/', '%']);

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
      if (WHITESPACE.has(b)) this.pos += 1;
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
    const start = this.pos;
    while (this.pos < this.bytes.length && !WHITESPACE.has(this.bytes[this.pos]) && !DELIMITERS.has(this.char())) {
      this.pos += 1;
    }
    return String.fromCharCode(...this.bytes.subarray(start, this.pos));
  }

  /** A keyword or operator: any bare word that is not a number, boolean, or null. Returns null at a value. */
  operator(): string | null {
    this.skip();
    const at = this.pos;
    const c = this.char();
    if (this.pos >= this.bytes.length || DELIMITERS.has(c) || /[\d+.-]/.test(c)) return null;
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
        const map: Record<number, number> = { 0x6e: 10, 0x72: 13, 0x74: 9, 0x62: 8, 0x66: 12 };
        if (n >= 0x30 && n <= 0x37) {
          let v = n - 0x30;
          for (let k = 0; k < 2 && this.bytes[this.pos] >= 0x30 && this.bytes[this.pos] <= 0x37; k += 1) {
            v = v * 8 + this.bytes[this.pos++] - 0x30;
          }
          out.push(v & 255);
        } else if (n === 10 || n === 13) {
          if (n === 13 && this.bytes[this.pos] === 10) this.pos += 1;
        } else out.push(map[n] ?? n);
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
    const digits: string[] = [];
    this.pos += 1;
    while (this.pos < this.bytes.length && this.char() !== '>') {
      if (/[0-9a-fA-F]/.test(this.char())) digits.push(this.char());
      this.pos += 1;
    }
    this.pos += 1;
    if (digits.length % 2 === 1) digits.push('0');
    const out = new Uint8Array(digits.length / 2);
    for (let i = 0; i < out.length; i += 1) out[i] = parseInt(digits[2 * i] + digits[2 * i + 1], 16);
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
    const w = this.word();
    if (w === 'true') return true;
    if (w === 'false') return false;
    if (w === 'null') return null;
    if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(w)) return this.numberOrRef(Number(w), w);
    this.pos = at;
    return undefined;
  }

  private numberOrRef(n: number, w: string): PdfValue {
    if (!/^\d+$/.test(w)) return n;
    const save = this.pos;
    this.skip();
    const gen = /^\d+/.exec(String.fromCharCode(...this.bytes.subarray(this.pos, this.pos + 8)));
    if (gen) {
      this.pos += gen[0].length;
      this.skip();
      if (this.char() === 'R' && !/[A-Za-z0-9]/.test(this.char(this.pos + 1) || ' ')) {
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
    }
    objects.set(Number(m[1]), { value, stream });
  }
  return objects;
}

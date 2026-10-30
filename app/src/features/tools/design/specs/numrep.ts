// checks-disable-file length: worked-step formulas are written as one line each

// The number representation tool: integers in two's complement and the other schemes, overflow, bases, floating point
// (half, single and double) with the exact stored value and its error, characters in Unicode, and the sizes of the
// common C++ integer types. The engine is ../numrep.ts.
import type { Row, ToolSpec, Values } from '../kit/spec';
import {
  CPP_TYPES,
  FLOAT_FORMATS,
  characters,
  decodeFloat,
  decodeInt,
  encodeDecimal,
  encodeInt,
  floatBits,
  fromBase,
  intRange,
  neighbour,
  parseInteger,
  toBase,
  wrapInt,
} from '../numrep';
import type { FloatFormat, IntScheme } from '../numrep';
import { bad } from '../types';
import { choiceField, failed, modeField, numField, success } from './helpers';

const MODES = ['encode', 'decode', 'overflow', 'base', 'float', 'floatBits', 'chars', 'types'];
const SCHEMES = ['twos', 'unsigned', 'ones', 'signmag', 'excess'];

const text = (v: Values, id: string): string => String(v[id] ?? '');
const scheme = (v: Values): IntScheme =>
  SCHEMES.includes(text(v, 'scheme')) ? (text(v, 'scheme') as IntScheme) : 'twos';
const bias = (v: Values): bigint => BigInt(Math.round(Number.isFinite(v.bias as number) ? (v.bias as number) : 0));

/** Bits in groups of four from the right. */
export const group4 = (bits: string): string => bits.replace(/(?=(?:[01]{4})+$)/g, ' ').trim();

const hexOf = (bits: string): string =>
  `0x${BigInt(`0b${bits}`)
    .toString(16)
    .toUpperCase()
    .padStart(Math.ceil(bits.length / 4), '0')}`;

function encodeRun(v: Values) {
  const value = parseInteger(text(v, 'value'));
  if (value === null) return failed(bad('notInteger'));
  const width = v.width as number;
  const s = scheme(v);
  const r = encodeInt(value, width, s, bias(v));
  if (!r.ok) {
    if (r.problem === 'outOfRange') {
      const { min, max } = intRange(width, s, bias(v));
      return { ok: false as const, problem: r.problem, detail: `${min} to ${max}` };
    }
    return failed(r);
  }
  const { min, max } = intRange(width, s, bias(v));
  return success({
    rows: [
      { id: 'bits', text: group4(r.bits), answer: true },
      { id: 'hex', text: hexOf(r.bits), answer: true },
      { id: 'value', text: String(r.value) },
      { id: 'min', text: String(min) },
      { id: 'max', text: String(max) },
    ],
    steps: r.steps,
    notes: ['integers'],
  });
}

function decodeRun(v: Values) {
  const bits = text(v, 'bits').replace(/[\s_]/g, '').replace(/^0b/i, '');
  const r = decodeInt(bits, scheme(v), bias(v));
  if (!r.ok) return failed(r);
  return success({
    rows: [
      { id: 'value', text: String(r.value), answer: true },
      { id: 'width', value: bits.length, digits: 4 },
      { id: 'hex', text: hexOf(bits) },
      ...(['unsigned', 'twos', 'ones', 'signmag'] as const).map((one) => {
        const d = decodeInt(bits, one);
        return { id: `as${one[0].toUpperCase()}${one.slice(1)}`, text: d.ok ? String(d.value) : '' };
      }),
    ],
    steps: [],
    notes: ['integers'],
  });
}

function overflowRun(v: Values) {
  const value = parseInteger(text(v, 'value'));
  if (value === null) return failed(bad('notInteger'));
  const width = v.width as number;
  if (!Number.isInteger(width) || width < 1 || width > 128) return failed(bad('widthRange'));
  const signed = text(v, 'signed') === 'signed';
  const wrapped = wrapInt(value, width, signed);
  const { min, max } = intRange(width, signed ? 'twos' : 'unsigned');
  return success({
    rows: [
      { id: 'wrapped', text: String(wrapped), answer: true },
      { id: 'fits', word: value >= min && value <= max ? 'yes' : 'no' },
      { id: 'min', text: String(min) },
      { id: 'max', text: String(max) },
    ],
    steps: [
      {
        key: 'wrap',
        latex: `${value}\\bmod 2^{${width}}=${((value % (1n << BigInt(width))) + (1n << BigInt(width))) % (1n << BigInt(width))}${signed ? `\\ \\to\\ ${wrapped}` : ''}`,
      },
    ],
    notes: ['overflow'],
  });
}

function baseRun(v: Values) {
  const from = v.from as number;
  const to = v.to as number;
  const parsed = fromBase(text(v, 'digits'), from);
  if (!parsed.ok) return failed(parsed);
  const out = toBase(parsed.value, to);
  if (!out.ok) return failed(out);
  return success({
    rows: [
      { id: 'result', text: out.text, answer: true },
      { id: 'decimal', text: String(parsed.value) },
    ],
    steps: out.steps,
    notes: ['base'],
  });
}

const format = (v: Values): FloatFormat =>
  FLOAT_FORMATS[text(v, 'format') as FloatFormat['name']] ?? FLOAT_FORMATS.single;

function floatBitsText(bits: bigint, f: FloatFormat): string {
  const all = bits.toString(2).padStart(floatBits(f), '0');
  return `${all.slice(0, 1)} ${all.slice(1, 1 + f.exp)} ${all.slice(1 + f.exp)}`;
}

function describeFloat(bits: bigint, f: FloatFormat): { rows: Row[]; steps: ReturnType<typeof decodeFloat> } {
  const d = decodeFloat(bits, f);
  if (!d.ok) return { rows: [], steps: d };
  const x = d.decoded;
  const rows: Row[] = [
    { id: 'bits', text: floatBitsText(bits, f), answer: true },
    {
      id: 'hex',
      text: `0x${bits
        .toString(16)
        .toUpperCase()
        .padStart(floatBits(f) / 4, '0')}`,
    },
    { id: 'sign', value: x.sign, digits: 2 },
    { id: 'exponent', value: Number(x.exponent), digits: 6 },
    { id: 'unbiased', value: x.cls === 'normal' ? Number(x.exponent) - f.bias : 1 - f.bias, digits: 6 },
    { id: 'fraction', text: String(x.fraction) },
    { id: 'class', word: x.cls },
    { id: 'shortest', text: x.shortest, answer: true },
    { id: 'exact', text: x.decimal },
  ];
  const up = neighbour(bits, f, true);
  const down = neighbour(bits, f, false);
  const next = up === null ? null : decodeFloat(up, f);
  const prev = down === null ? null : decodeFloat(down, f);
  if (next?.ok) rows.push({ id: 'up', text: next.decoded.shortest });
  if (prev?.ok) rows.push({ id: 'down', text: prev.decoded.shortest });
  return { rows, steps: d };
}

function floatRun(v: Values) {
  const f = format(v);
  const r = encodeDecimal(text(v, 'decimal'), f);
  if (!r.ok) return failed(r);
  const { rows, steps } = describeFloat(r.encoding.bits, f);
  if (!steps.ok) return failed(steps);
  rows.push(
    { id: 'error', text: r.encoding.error },
    { id: 'rounded', word: r.encoding.overflow ? 'overflow' : r.encoding.rounded ? 'yes' : 'no' },
  );
  return success({ rows, steps: [...r.encoding.steps, ...steps.decoded.steps], notes: ['float'] });
}

function parseBits(raw: string, f: FloatFormat): bigint | null {
  const t = raw.replace(/[\s_]/g, '');
  if (/^0x[0-9a-f]+$/i.test(t)) return BigInt(t);
  const b = t.replace(/^0b/i, '');
  if (/^[01]+$/.test(b) && b.length === floatBits(f)) return BigInt(`0b${b}`);
  return null;
}

function floatBitsRun(v: Values) {
  const f = format(v);
  const bits = parseBits(text(v, 'pattern'), f);
  if (bits === null) return failed({ ok: false, problem: 'floatPattern' });
  const { rows, steps } = describeFloat(bits, f);
  if (!steps.ok) return failed(steps);
  return success({ rows, steps: steps.decoded.steps, notes: ['float'] });
}

function charsRun(v: Values) {
  const input = text(v, 'chars');
  const list = characters(input).slice(0, 200);
  if (list.length === 0) return failed(bad('noCharacters'));
  const hex = (n: number, pad = 2) => n.toString(16).toUpperCase().padStart(pad, '0');
  return success({
    rows: [
      { id: 'count', value: list.length, digits: 4 },
      { id: 'bytes', value: new TextEncoder().encode(list.map((c) => c.char).join('')).length, digits: 5 },
    ],
    steps: [],
    tables: [
      {
        id: 'characters',
        columns: ['char', 'point', 'utf8', 'utf16'],
        rows: list.map((c) => [
          c.name ?? c.char,
          `U+${hex(c.codePoint, 4)}`,
          c.utf8.map((b) => hex(b)).join(' '),
          c.utf16.map((u) => hex(u, 4)).join(' '),
        ]),
      },
    ],
    notes: ['chars'],
  });
}

function typesRun() {
  return success({
    rows: [{ id: 'count', value: CPP_TYPES.length, digits: 3 }],
    steps: [],
    tables: [
      {
        id: 'types',
        columns: ['type', 'bits', 'min', 'max'],
        rows: CPP_TYPES.map((t) => [t.name, String(t.bits), String(t.min), String(t.max)]),
      },
    ],
    notes: ['types'],
  });
}

const RUNNERS: Record<string, (v: Values) => ReturnType<typeof typesRun> | ReturnType<typeof failed>> = {
  encode: encodeRun,
  decode: decodeRun,
  overflow: overflowRun,
  base: baseRun,
  float: floatRun,
  floatBits: floatBitsRun,
  chars: charsRun,
  types: typesRun,
};

const bitsMode = (v: Values) => v.mode === 'encode' || v.mode === 'decode';

export const numrepSpec: ToolSpec = {
  fields: [
    modeField(MODES),
    { type: 'text', id: 'value', def: '-42', rows: 1, when: (v) => v.mode === 'encode' || v.mode === 'overflow' },
    numField('width', '8', undefined, 'encode', 'overflow'),
    { type: 'text', id: 'bits', def: '1101 0110', rows: 1, when: (v) => v.mode === 'decode' },
    { ...choiceField('scheme', SCHEMES, 'twos'), when: bitsMode },
    { ...numField('bias', '127', undefined), when: (v) => bitsMode(v) && v.scheme === 'excess' },
    choiceField('signed', ['signed', 'unsigned'], 'signed', 'overflow'),
    { type: 'text', id: 'digits', def: '255', rows: 1, when: (v) => v.mode === 'base' },
    numField('from', '10', undefined, 'base'),
    numField('to', '2', undefined, 'base'),
    {
      ...choiceField('format', ['half', 'single', 'double'], 'single'),
      when: (v) => v.mode === 'float' || v.mode === 'floatBits',
    },
    { type: 'text', id: 'decimal', def: '0.1', rows: 1, when: (v) => v.mode === 'float' },
    { type: 'text', id: 'pattern', def: '0x3DCCCCCD', rows: 1, when: (v) => v.mode === 'floatBits' },
    { type: 'text', id: 'chars', def: 'Aé€😀', rows: 2, when: (v) => v.mode === 'chars' },
  ],
  run: (v) => (RUNNERS[String(v.mode)] ?? encodeRun)(v),
  examples: [
    { id: 'minus42', values: { mode: 'encode', value: '-42', width: '8', scheme: 'twos' } },
    { id: 'byte', values: { mode: 'decode', bits: '1101 0110', scheme: 'twos' } },
    { id: 'wrap', values: { mode: 'overflow', value: '200', width: '8', signed: 'signed' } },
    { id: 'hex', values: { mode: 'base', digits: '255', from: '10', to: '16' } },
    { id: 'tenth', values: { mode: 'float', decimal: '0.1', format: 'single' } },
    { id: 'pi', values: { mode: 'floatBits', pattern: '0x40490FDB', format: 'single' } },
    { id: 'unicode', values: { mode: 'chars', chars: 'Aé€😀' } },
    { id: 'ctypes', values: { mode: 'types' } },
  ],
};

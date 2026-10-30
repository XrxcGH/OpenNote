// Built-in functions, part three: printing (disp, fprintf, sprintf, num2str, mat2str), a few text functions, and
// the plot commands, which draw on the console's current figure.
import { KitError } from '../types';
import { argc, type Table } from './builtinsA';
import type { Builtin, Ctx } from './ctx';
import { newFigure } from './ctx';
import { dispLines } from './format';
import { colonRange } from './ops';
import { asMat, asNumber, bool, columnMajor, mat, numel, scalar, text, toRows, type M, type Value } from './values';

const textOf = (v: Value, what: string): string => {
  const m = asMat(v, what);
  if (m.str === undefined) throw new KitError('mcNeedText', what);
  return m.str;
};

/** C-style %g: the shortest of fixed and exponent notation with `precision` significant digits. */
export function gFormat(x: number, precision = 6): string {
  if (!Number.isFinite(x)) return Number.isNaN(x) ? 'NaN' : x > 0 ? 'Inf' : '-Inf';
  if (x === 0) return '0';
  const p = Math.max(1, precision);
  const exp = Math.floor(Math.log10(Math.abs(Number(x.toPrecision(p)))));
  if (exp < -5 || exp >= p) {
    const [m, e] = x.toExponential(p - 1).split('e');
    const mant = m.includes('.') ? m.replace(/0+$/, '').replace(/\.$/, '') : m;
    return `${mant}e${Number(e) < 0 ? '-' : '+'}${String(Math.abs(Number(e))).padStart(2, '0')}`;
  }
  return String(Number(x.toPrecision(p)));
}

interface Spec {
  flags: string;
  width: number;
  precision: number | null;
  conv: string;
}
type Piece = string | Spec;

function unescape(s: string): string {
  return s.replace(
    /\\([ntr\\"'abf])/g,
    (_, c: string) => ({ n: '\n', t: '\t', r: '\r', '\\': '\\', '"': '"', "'": "'", a: '\x07', b: '\b', f: '\f' })[c]!,
  );
}

function parseFormat(fmt: string): Piece[] {
  const pieces: Piece[] = [];
  const re = /%(%|([-+ 0#]*)(\d+)?(?:\.(\d+))?([diouxXfeEgGcs]))/g;
  let last = 0;
  for (let m = re.exec(fmt); m; m = re.exec(fmt)) {
    if (m.index > last) pieces.push(unescape(fmt.slice(last, m.index)));
    if (m[1] === '%') pieces.push('%');
    else
      pieces.push({
        flags: m[2] ?? '',
        width: Number(m[3] ?? 0),
        precision: m[4] === undefined ? null : Number(m[4]),
        conv: m[5],
      });
    last = m.index + m[0].length;
  }
  if (last < fmt.length) pieces.push(unescape(fmt.slice(last)));
  return pieces;
}

function render(spec: Spec, item: number | string): string {
  const { conv, precision } = spec;
  let body: string;
  if (conv === 's' || conv === 'c')
    body =
      typeof item === 'string'
        ? item
        : Number.isInteger(item) && conv === 'c'
          ? String.fromCharCode(item)
          : gFormat(item, precision ?? 6);
  else {
    const x = typeof item === 'string' ? item.charCodeAt(0) : item;
    if ('diu'.includes(conv)) body = Number.isInteger(x) ? String(x) : expFormat(x, 6);
    else if (conv === 'f') body = Number.isFinite(x) ? x.toFixed(precision ?? 6) : gFormat(x);
    else if (conv === 'e' || conv === 'E') body = expFormat(x, precision ?? 6);
    else if (conv === 'g' || conv === 'G') body = gFormat(x, precision ?? 6);
    else if (conv === 'x' || conv === 'X') body = Math.trunc(x).toString(16);
    else body = Math.trunc(x).toString(8);
    if (conv === 'X' || conv === 'E' || conv === 'G') body = body.toUpperCase();
    if (spec.flags.includes('+') && x >= 0) body = `+${body}`;
    else if (spec.flags.includes(' ') && x >= 0) body = ` ${body}`;
  }
  if (body.length >= spec.width) return body;
  if (spec.flags.includes('-')) return body.padEnd(spec.width);
  if (spec.flags.includes('0') && conv !== 's' && /^[-+ ]?\d/.test(body)) {
    const sign = /^[-+ ]/.test(body) ? body[0] : '';
    return sign + body.slice(sign.length).padStart(spec.width - sign.length, '0');
  }
  return body.padStart(spec.width);
}

function expFormat(x: number, digits: number): string {
  if (!Number.isFinite(x)) return gFormat(x);
  const [m, e] = x.toExponential(digits).split('e');
  return `${m}e${Number(e) < 0 ? '-' : '+'}${String(Math.abs(Number(e))).padStart(2, '0')}`;
}

/** The text fprintf and sprintf make: the format is reused until every value is used. */
export function formatText(fmt: string, args: Value[]): string {
  const items: (number | string)[] = args.flatMap((a): (number | string)[] => {
    const m = asMat(a, 'argument');
    return m.str !== undefined ? [m.str] : columnMajor(m);
  });
  const pieces = parseFormat(fmt);
  const specs = pieces.filter((p) => typeof p !== 'string').length;
  if (specs === 0) return pieces.join('');
  let out = '';
  let next = 0;
  do {
    for (const piece of pieces) {
      if (typeof piece === 'string') {
        out += piece;
        continue;
      }
      if (next >= items.length && items.length > 0) return out;
      out += next < items.length ? render(piece, items[next++]) : '';
    }
  } while (next < items.length);
  return out;
}

function num2str(args: Value[]): Value[] {
  argc('num2str', args, 1, 2);
  const m = asMat(args[0], 'num2str');
  if (m.str !== undefined) return [m];
  const second = args[1] ? asMat(args[1], 'format') : null;
  const one = (x: number) => {
    if (second?.str !== undefined) return formatText(second.str, [scalar(x)]);
    if (second) return gFormat(x, second.d[0]);
    if (Number.isInteger(x)) return String(x);
    const digits = Math.min(16, Math.max(5, Math.floor(Math.log10(Math.abs(x))) + 5));
    return gFormat(x, digits);
  };
  const rows = toRows(m).map((row) => row.map(one).join('  '));
  return [text(rows.join('\n'))];
}

function mat2str(args: Value[]): Value[] {
  const m = asMat(args[0], 'mat2str');
  const p = args[1] ? asNumber(args[1], 'precision') : 15;
  const one = (x: number) => gFormat(x, p);
  if (m.str !== undefined) return [text(`"${m.str}"`)];
  if (numel(m) === 1) return [text(m.logical ? (m.d[0] ? 'true' : 'false') : one(m.d[0]))];
  return [
    text(
      `[${toRows(m)
        .map((row) => row.map(one).join(' '))
        .join(';')}]`,
    ),
  ];
}

function dispBuiltin(args: Value[], _n: number, ctx: Ctx): Value[] {
  argc('disp', args, 1);
  ctx.print(dispLines(args[0], ctx.format.long));
  return [];
}

// ---------------------------------------------------------------------------------------------------------------
// Plots
// ---------------------------------------------------------------------------------------------------------------

function ensureFresh(ctx: Ctx): void {
  if (!ctx.hold.on) ctx.figure.series = [];
  ctx.figure.changed = true;
}

function addSeries(ctx: Ctx, x: number[], y: number[], dots: boolean): void {
  if (x.length !== y.length) throw new KitError('mcDimsAgree');
  ctx.figure.series.push({ x, y, dots, name: `data${ctx.figure.series.length + 1}` });
}

function plotBuiltin(args: Value[], _n: number, ctx: Ctx): Value[] {
  ensureFresh(ctx);
  const nums = args.filter((a) => !(a.kind === 'mat' && a.str !== undefined));
  const specs = args.map((a, i) => ({ a, i })).filter(({ a }) => a.kind === 'mat' && a.str !== undefined);
  let k = 0;
  while (k < nums.length) {
    const first = asMat(nums[k], 'plot');
    const second = nums[k + 1] ? asMat(nums[k + 1], 'plot') : null;
    const useX = second !== null;
    const y = useX ? second! : first;
    const x = useX ? first.d : y.d.map((_, i) => i + 1);
    k += useX ? 2 : 1;
    const marker = specs.some(({ a }) => /[o*+x.sd^v]/.test((a as M).str!) && !/[-:]/.test((a as M).str!));
    if (y.r > 1 && y.c > 1) {
      const rows = toRows(y);
      for (let j = 0; j < y.c; j++)
        addSeries(
          ctx,
          x.length === y.c ? x : rows.map((_, i) => i + 1),
          rows.map((row) => row[j]),
          marker,
        );
    } else addSeries(ctx, x.slice(), y.d.slice(), marker);
  }
  return [];
}

function fplot(args: Value[], _n: number, ctx: Ctx): Value[] {
  argc('fplot', args, 1, 2);
  const range = args[1] ? asMat(args[1], 'interval').d : [-5, 5];
  const [a, b] = range;
  const xs = colonRange(a, (b - a) / 300, b).d;
  const ys = xs.map((x) => asNumber(ctx.call(args[0], [scalar(x)])[0], 'f(x)'));
  ensureFresh(ctx);
  addSeries(ctx, xs, ys, false);
  return [];
}

function labeler(field: 'title' | 'xlabel' | 'ylabel'): Builtin {
  return (args, _n, ctx) => {
    ctx.figure[field] = textOf(args[0], field);
    ctx.figure.changed = true;
    return [];
  };
}

function logAxis(x: boolean, y: boolean): Builtin {
  return (args, n, ctx) => {
    const out = plotBuiltin(args, n, ctx);
    ctx.figure.logx = x;
    ctx.figure.logy = y;
    return out;
  };
}

function holdBuiltin(args: Value[], _n: number, ctx: Ctx): Value[] {
  const word = args[0] ? textOf(args[0], 'hold').toLowerCase() : ctx.hold.on ? 'off' : 'on';
  ctx.hold.on = word === 'on';
  return [];
}

function resetFigure(_a: Value[], _n: number, ctx: Ctx): Value[] {
  Object.assign(ctx.figure, newFigure());
  return [];
}

function legend(args: Value[], _n: number, ctx: Ctx): Value[] {
  args.forEach((a, i) => {
    if (ctx.figure.series[i] && a.kind === 'mat' && a.str !== undefined) ctx.figure.series[i].name = a.str;
  });
  ctx.figure.changed = true;
  return [];
}

function errorBuiltin(args: Value[]): Value[] {
  const [first, ...rest] = args;
  throw new KitError('mcUser', formatText(textOf(first, 'error'), rest));
}

function warningBuiltin(args: Value[], _n: number, ctx: Ctx): Value[] {
  const [first, ...rest] = args;
  ctx.print([`Warning: ${formatText(textOf(first, 'warning'), rest)}`]);
  return [];
}

function strBuiltin(name: string, f: (s: string, rest: Value[]) => Value): Builtin {
  return (args) => [f(textOf(args[0], name), args.slice(1))];
}

export function registerC(t: Table): void {
  const def = (name: string, f: Builtin) => t.set(name, f);
  def('disp', dispBuiltin);
  def('display', dispBuiltin);
  def('fprintf', (args, _n, ctx) => {
    const first = args[0] && asMat(args[0], 'fprintf').str === undefined ? args.slice(1) : args;
    const [fmt, ...rest] = first;
    ctx.print(
      formatText(textOf(fmt, 'format'), rest)
        .split('\n')
        .map((l, i, all) => (i === all.length - 1 && l === '' ? null : l))
        .filter((l): l is string => l !== null),
    );
    return [];
  });
  def('sprintf', (args) => [text(formatText(textOf(args[0], 'format'), args.slice(1)))]);
  def('num2str', num2str);
  def('mat2str', mat2str);
  def('int2str', (args) => {
    const m = asMat(args[0], 'int2str');
    return num2str([
      mat(
        m.r,
        m.c,
        m.d.map((x) => Math.round(x)),
      ),
    ]);
  });
  def('str2double', (args) => [scalar(Number(textOf(args[0], 'str2double').trim() || NaN))]);
  def('error', errorBuiltin);
  def('warning', warningBuiltin);
  def(
    'upper',
    strBuiltin('upper', (s) => text(s.toUpperCase())),
  );
  def(
    'lower',
    strBuiltin('lower', (s) => text(s.toLowerCase())),
  );
  def('strcat', (args) => [text(args.map((a) => textOf(a, 'strcat')).join(''))]);
  def('strcmp', (args) => [bool(textOf(args[0], 'strcmp') === textOf(args[1], 'strcmp'))]);
  def('plot', plotBuiltin);
  def('scatter', (args, n, ctx) => plotBuiltin([...args, text('o')], n, ctx));
  def('semilogx', logAxis(true, false));
  def('semilogy', logAxis(false, true));
  def('loglog', logAxis(true, true));
  def('fplot', fplot);
  def('hold', holdBuiltin);
  def('figure', resetFigure);
  def('clf', resetFigure);
  def('close', resetFigure);
  def('xlabel', labeler('xlabel'));
  def('ylabel', labeler('ylabel'));
  def('title', labeler('title'));
  def('legend', legend);
  for (const quiet of ['grid', 'axis', 'subplot', 'box', 'drawnow']) def(quiet, () => []);
  def('format', (args, _n, ctx) => {
    ctx.format.long = args[0] !== undefined && textOf(args[0], 'format').toLowerCase() === 'long';
    return [];
  });
}

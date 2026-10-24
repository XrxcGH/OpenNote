// How the console prints a value, in the style of MATLAB's short format: integers as integers, other numbers with
// four decimals, and a common scale factor when the numbers are large or small.
import type { M, Value } from './values';

const pad = (s: string, w: number) => s.padStart(w);

function expText(x: number, digits: number): string {
  const [m, e] = x.toExponential(digits).split('e');
  const n = Number(e);
  return `${m}e${n < 0 ? '-' : '+'}${String(Math.abs(n)).padStart(2, '0')}`;
}

/** One number as the console prints a single value. */
export function scalarText(x: number, long = false): string {
  if (Number.isNaN(x)) return 'NaN';
  if (!Number.isFinite(x)) return x > 0 ? 'Inf' : '-Inf';
  if (Number.isInteger(x)) return Math.abs(x) < 1e9 ? String(x) : expText(x, long ? 15 : 4);
  const abs = Math.abs(x);
  if (abs >= 1e5 || abs < 1e-5) return expText(x, long ? 15 : 4);
  if (long) return String(Number(x.toPrecision(16)));
  return abs >= 1000 ? expText(x, 4) : x.toFixed(4);
}

function columns(m: M, long: boolean): string[] {
  const finite = m.d.filter(Number.isFinite);
  const allInt = m.d.every((x) => Number.isInteger(x) || !Number.isFinite(x)) && finite.every((x) => Math.abs(x) < 1e9);
  const rows: string[] = [];
  if (allInt) {
    const digits = Math.max(1, ...finite.map((x) => String(Math.abs(x)).length));
    const w = Math.max(6, digits + 3 + (finite.some((x) => x < 0) ? 1 : 0));
    for (let i = 0; i < m.r; i++)
      rows.push(
        m.d
          .slice(i * m.c, (i + 1) * m.c)
          .map((x) => pad(scalarText(x), w))
          .join(''),
      );
    return rows;
  }
  const big = Math.max(0, ...finite.map(Math.abs));
  const small = Math.min(Infinity, ...finite.filter((x) => x !== 0).map(Math.abs));
  const places = long ? 15 : 4;
  const w = long ? 22 : 10;
  const exponent =
    big >= 1000 || (big > 0 && big < 0.001) || (small < 1e-5 && big > 0) ? Math.floor(Math.log10(big)) : 0;
  const shown = (x: number) => {
    if (!Number.isFinite(x)) return scalarText(x);
    return (x / 10 ** exponent).toFixed(places);
  };
  if (exponent !== 0)
    rows.push(`   1.0e${exponent < 0 ? '-' : '+'}${String(Math.abs(exponent)).padStart(2, '0')} *`, '');
  for (let i = 0; i < m.r; i++)
    rows.push(
      m.d
        .slice(i * m.c, (i + 1) * m.c)
        .map((x) => pad(shown(x), w))
        .join(''),
    );
  return rows;
}

/** The lines the console prints for `name = value`. */
export function formatValue(name: string, v: Value, long = false): string[] {
  if (v.kind === 'fn') return [`${name} =`, '', `  ${v.src}`, ''];
  if (v.str !== undefined) return [`${name} = ${v.str}`];
  if (v.r === 0 || v.c === 0) return [`${name} = [](${v.r}x${v.c})`];
  if (v.r === 1 && v.c === 1) return [`${name} = ${scalarText(v.d[0], long)}`];
  return [`${name} =`, '', ...columns(v, long), ''];
}

/** What disp prints: the value alone. */
export function dispLines(v: Value, long = false): string[] {
  if (v.kind === 'fn') return [v.src];
  if (v.str !== undefined) return [v.str];
  if (v.r === 0 || v.c === 0) return [];
  if (v.r === 1 && v.c === 1) return [scalarText(v.d[0], long)];
  return columns(v, long);
}

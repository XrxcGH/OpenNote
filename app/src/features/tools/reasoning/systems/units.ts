// Quantities typed with an optional unit, such as 10 Mbit/s, 2.5 km, 20 ms, or 1500 B, read into base units: seconds,
// bits per second, bits, meters, and meters per second. A bare number is taken in the field's own unit. A unit of the
// wrong kind (ms in a rate field) is an error that names the field and the kinds it takes.
import { fail } from '../core/util';

export type QuantityKind = 'time' | 'rate' | 'size' | 'distance' | 'speed';

const SI: Readonly<Record<string, number>> = { '': 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };

const UNITS: Readonly<Record<string, readonly [QuantityKind, number]>> = {
  s: ['time', 1],
  ms: ['time', 1e-3],
  us: ['time', 1e-6],
  µs: ['time', 1e-6],
  ns: ['time', 1e-9],
  m: ['distance', 1],
  km: ['distance', 1e3],
  'm/s': ['speed', 1],
  'km/s': ['speed', 1e3],
};

function unitOf(u: string): readonly [QuantityKind, number] | null {
  if (UNITS[u]) return UNITS[u];
  // Rates: bps, kbps, Mbit/s, Gb/s; sizes: b, bit, B, byte, KB, MiB, kbit.
  const rate = /^([kKMGT]?)(?:bps|bit\/s|b\/s)$/.exec(u);
  if (rate) return ['rate', SI[rate[1]]];
  const rateBytes = /^([kKMGT]?)(?:B\/s|Bps)$/.exec(u);
  if (rateBytes) return ['rate', 8 * SI[rateBytes[1]]];
  const bin = /^([KMGT])i(B|b|bit)$/.exec(u);
  if (bin) return ['size', 1024 ** ' KMGT'.indexOf(bin[1]) * (bin[2] === 'B' ? 8 : 1)];
  const size = /^([kKMGT]?)(B|bytes?|b|bits?)$/.exec(u);
  if (size) return ['size', SI[size[1]] * (size[2].startsWith('B') || size[2].startsWith('byte') ? 8 : 1)];
  return null;
}

/** The value of `text` in base units of `kind`; a bare number is multiplied by `bare` (its unit in base units). */
export function quantity(text: string, kind: QuantityKind, field: string, bare = 1): number {
  const m = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*(\S*)\s*$/i.exec(text);
  if (!m) return fail('quantity', { field });
  const x = Number(m[1]);
  if (!m[2]) return x * bare;
  const u = unitOf(m[2]);
  if (!u) return fail('unknownUnit', { field, unit: m[2] });
  if (u[0] !== kind) return fail(`unitKind.${kind}`, { field, unit: m[2] });
  return x * u[1];
}

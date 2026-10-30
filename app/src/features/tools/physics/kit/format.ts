// Numbers as text for results and worked steps: 5 significant figures by default, a power of ten written 1.2×10⁻⁵,
// and a true minus sign. The LaTeX form writes 1.2\times10^{-5}.
import { formatNumber } from '../../../../core/expr';
import { superscriptPower } from '../../../../core/units';
import { fromSI } from './units';
import type { DimId } from './units';

/** A number as text, such as 374.17, 8.8542×10⁻¹¹ or −0.25. */
export function fmt(value: number, digits = 5): string {
  if (Number.isNaN(value)) return '—';
  if (!Number.isFinite(value)) return value > 0 ? '∞' : '−∞';
  const text = formatNumber(value, { digits });
  const negative = text.startsWith('-');
  const body = superscriptPower(negative ? text.slice(1) : text);
  return negative ? `−${body}` : body;
}

/** A number in LaTeX. */
export function tex(value: number, digits = 5): string {
  if (!Number.isFinite(value)) return value > 0 ? '\\infty' : value < 0 ? '-\\infty' : '\\text{—}';
  const text = formatNumber(value, { digits });
  const match = /^(-?[\d.]+)e([+-]?\d+)$/.exec(text);
  if (!match) return text;
  return `${match[1]}\\times10^{${Number(match[2])}}`;
}

/** A quantity as text: the number in the unit, then the unit. */
export function q(value: number, unit: string, digits = 5): string {
  return unit === '' ? fmt(value, digits) : `${fmt(value, digits)} ${unit}`;
}

/** A quantity held in SI, written in another unit of its dimension. */
export function qIn(valueSI: number, dim: DimId, unit: string, digits = 5): string {
  return q(fromSI(valueSI, dim, unit), unit, digits);
}

/** Degrees from radians. */
export const deg = (radians: number): number => (radians * 180) / Math.PI;
/** Radians from degrees. */
export const rad = (degrees: number): number => (degrees * Math.PI) / 180;

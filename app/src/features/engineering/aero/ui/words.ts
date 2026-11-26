// Turns the keys that specs and engines name into words: a tool's section of the kitAero strings, values that point
// at other keys ("@layer.troposphere"), problems, and numbers with units in the chosen system.
import '../text';
import { kitAero } from '../../../../strings/en/kitAero';
import { t } from '../../../../strings/t';
import { AeroError, num } from '../common';
import type { AeroStep } from '../common';
import type { AeroToolId } from '../meta';
import type { Row } from './spec';
import { defaultUnit, fromSI } from './units';
import type { UnitSystem } from './units';

type Vars = Readonly<Record<string, string>>;
const look = t as unknown as (key: string, vars?: Vars) => string;

/** Whether the tool's section has this key, such as "h.altitude". */
export function hasText(tool: AeroToolId, path: string): boolean {
  let at: unknown = kitAero.t[tool];
  for (const part of path.split('.')) {
    if (!at || typeof at !== 'object' || !(part in at)) return false;
    at = (at as Record<string, unknown>)[part];
  }
  return typeof at === 'string';
}

/** Values that start with @ name another key in the same section. */
function fill(tool: AeroToolId, vars: Vars | undefined): Vars | undefined {
  if (!vars) return undefined;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars)) {
    out[name] = value.startsWith('@') && hasText(tool, value.slice(1)) ? toolText(tool, value.slice(1)) : value;
  }
  return out;
}

export function toolText(tool: AeroToolId, path: string, vars?: Vars): string {
  return look(`kitAero.t.${tool}.${path}`, fill(tool, vars));
}

export const stepText = (tool: AeroToolId, step: AeroStep): string => toolText(tool, `s.${step.key}`, step.vars);

export function errorText(tool: AeroToolId, error: AeroError): string {
  const vars = fill(tool, error.vars);
  return error.code in kitAero.error
    ? look(`kitAero.error.${error.code}`, vars)
    : look(`kitAero.t.${tool}.e.${error.code}`, vars);
}

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};

/** A number for people: a power of ten as × 10ⁿ and a true minus sign. */
export function pretty(value: number, sig = 5): string {
  const text = num(value, sig);
  const at = text.indexOf('e');
  const shown =
    at < 0 || text.includes('infty')
      ? text.replace('\\infty', '∞')
      : `${text.slice(0, at)} × 10${[...text.slice(at + 1)].map((c) => SUPERSCRIPT[c] ?? c).join('')}`;
  return shown.replace(/^-/, '−');
}

/** A result row's value, in the system's first unit when it measures something. */
export function rowValue(tool: AeroToolId, row: Row, system: UnitSystem): string {
  if (row.text !== undefined) return row.text;
  if (row.word !== undefined) return toolText(tool, row.word.replace(/^@/, ''), row.vars);
  if (row.value === undefined) return '';
  if (row.qty) {
    const unit = defaultUnit(row.qty, system);
    return `${pretty(fromSI(row.value, unit), row.sig)} ${unit.sym}`;
  }
  if (!row.unit) return pretty(row.value, row.sig);
  // Degrees sit against the number, as 39.3°; every other unit takes a space.
  return row.unit === '°' ? `${pretty(row.value, row.sig)}°` : `${pretty(row.value, row.sig)} ${row.unit}`;
}

export const rowLabel = (tool: AeroToolId, row: Row): string => toolText(tool, `r.${row.label ?? row.id}`, row.vars);

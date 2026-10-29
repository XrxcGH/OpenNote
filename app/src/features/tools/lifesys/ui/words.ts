// Turns an engine's string key and values into words: numbers are rounded to 6 significant figures, and an error
// from an engine becomes its sentence. A tool's own words come from kitLifeSysTools, which loads with the window;
// the shared ones (the window, errors, and tool names) are in the kitLifeSys namespace of t().
import { kitLifeSysTools } from '../../../../strings/en/kitLifeSysTools';
import { formatMessage, t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import { LsError } from '../num/errors';
import type { LsKey, LsVars } from '../num/errors';
import { formatNumber } from './text';

type Loose = (key: MessageKey, values?: Record<string, unknown>) => string;

/** The sentence at kitLifeSys.<key>, with numeric values rounded. */
export function word(key: LsKey, vars?: LsVars): string {
  const values = vars
    ? Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, typeof v === 'number' ? formatNumber(v) : v]))
    : undefined;
  const own = key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], kitLifeSysTools);
  if (typeof own === 'string') return formatMessage(own, values);
  return (t as unknown as Loose)(`kitLifeSys.${key}` as MessageKey, values);
}

/** The sentence for anything an engine or a form throws. */
export function problem(error: unknown): string {
  if (error instanceof LsError) return word(error.key, error.vars);
  return word('errors.unknown');
}

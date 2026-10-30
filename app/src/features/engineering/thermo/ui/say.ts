// t() for keys built at run time, such as a step's key or a result's name. Each key exists in
// strings/en/kitThermo.ts, and the engines' key types are taken from that file, so a wrong key fails type-checking
// where it is made.
import { t } from '../../../../strings/t';
import { ThermoError } from '../common/types';

export const say = t as unknown as (key: string, vars?: Readonly<Record<string, string | number>>) => string;

/** The words for a problem an engine ran into. */
export function describe(error: unknown): string {
  if (error instanceof ThermoError) return say(`kitThermo.error.${error.code}`, error.vars);
  return say('kitThermo.error.unknown');
}

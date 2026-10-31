// Words for the kit's message keys. Numbers are shown to 6 significant figures; a string value that starts with ~
// is itself a key, such as the name of a soil group, and is worded too.
import '../text';
import { t } from '../../../../strings/t';
import { fmt } from '../core/format';
import type { Msg, Vars } from '../core/types';

const lookup = t as unknown as (key: string, values?: Record<string, unknown>) => string;

function words(vars: Vars | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(vars ?? {}))
    out[name] = typeof value === 'number' ? fmt(value) : value.startsWith('~') ? label(value.slice(1)) : value;
  return out;
}

/** The text of a key under kitCivil. */
export const label = (key: string): string => lookup(`kitCivil.${key}`);

export const say = (msg: Msg): string => lookup(`kitCivil.${msg.key}`, words(msg.vars));

// Looks up the kit's messages by the keys engines name. The keys are checked against the strings file by their
// types; a `field` variable is itself a key, the label of the field a message is about.
import './text';
import { t } from '../../../strings/t';
import type { Label } from './figure';
import type { MolKey, Vars } from './shared';

const lookup = t as unknown as (key: string, vars?: Vars) => string;

export function say(key: MolKey, vars?: Vars): string {
  const field = vars?.field;
  const resolved = field ? { ...vars, field: lookup(`kitMolBio.${field}`) } : vars;
  return lookup(`kitMolBio.${key}`, resolved);
}

export const sayLabel = (label: Label): string => (typeof label === 'string' ? label : say(label.word, label.vars));

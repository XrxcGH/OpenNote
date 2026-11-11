// Names for the pane's options. A value with its own string uses it; others (the 30-odd border styles, the OpenType
// stylistic sets) are made from the value, so no option shows a raw identifier.
import { textPane } from '../../../strings/en/textPane';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';

const OPTIONS = textPane.opt as Readonly<Record<string, Readonly<Record<string, string>>>>;

/** "horzStripe" as "Horz stripe": the words of a camel-case identifier. */
function words(value: string): string {
  const spaced = value.replace(/([a-z])([A-Z0-9])/g, '$1 $2').replace(/[-_]/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/** The name of an option of a field. '' is the field's "none" or "default". */
export function optionLabel(field: string, value: string): string {
  const key = value === '' ? 'none' : value;
  if (OPTIONS[field]?.[key] !== undefined) return t(`textPane.opt.${field}.${key}` as MessageKey);
  const set = /^ss(\d\d)$/.exec(value);
  if (set) return t('textPane.setN', { n: String(Number(set[1])) });
  return words(value);
}

/** The label of a field. */
export const fieldLabel = (id: string): string => t(`textPane.field.${id}` as MessageKey);

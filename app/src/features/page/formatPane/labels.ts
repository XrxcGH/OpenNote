// Names for the pane's options. Every value has its own string (a test checks the border styles, shading patterns,
// and number formats), apart from the OpenType stylistic sets, which share one message.
import { textPane } from '../../../strings/en/textPane';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';

const OPTIONS = textPane.opt as Readonly<Record<string, Readonly<Record<string, string>>>>;

/** The name of an option of a field. '' is the field's "none" or "default". */
export function optionLabel(field: string, value: string): string {
  const key = value === '' ? 'none' : value;
  if (OPTIONS[field]?.[key] !== undefined) return t(`textPane.opt.${field}.${key}` as MessageKey);
  const set = /^ss(\d\d)$/.exec(value);
  if (set) return t('textPane.setN', { n: String(Number(set[1])) });
  return value;
}

/** The label of a field. */
export const fieldLabel = (id: string): string => t(`textPane.field.${id}` as MessageKey);

// How a tool of this kit describes itself to the window: its fields, and the function that turns the typed values (in
// base units) into an answer. The window draws every tool the same way from this description.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';
import type { Outcome } from './types';
import type { UnitDim } from './units';

export interface FieldSpec {
  id: string;
  label: MessageKey;
  kind: 'number' | 'text' | 'area' | 'choice';
  /** The starting text (in the SI unit for a number with units). */
  initial: string;
  /** The quantity of a number field, which gives it a unit picker; absent for a plain number. */
  dim?: UnitDim;
  choices?: readonly { value: string; label: MessageKey }[];
  help?: MessageKey;
  /** Left empty, an optional number reaches the solver as NaN instead of being an error. */
  optional?: boolean;
  /** Shown only when this returns true for the current text values. */
  when?: (values: Readonly<Record<string, string>>) => boolean;
}

export type Input = Record<string, number | string>;

export interface ToolSpec {
  id: string;
  title: MessageKey;
  intro: MessageKey;
  keywords: MessageKey;
  open: MessageKey;
  icon: IconName;
  fields: readonly FieldSpec[];
  /** Solves from numbers in base units (see units.ts) and the text of the other fields. */
  solve(input: Input): Outcome;
}

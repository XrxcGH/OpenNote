// Shapes of the validation lane: the context a check runs in and what a check says.
import type { EngineEnv, Locale, Table } from '../../engine';
import type { Sheet } from '../model';

/** Everything a check reads. `table` must be calculated (its cells hold values). */
export interface Context {
  table: Table;
  sheet: Sheet;
  locale: Locale;
  env?: EngineEnv;
}

export type Alert = 'stop' | 'warning' | 'information';
export type Reason = 'type' | 'range' | 'list' | 'length' | 'custom' | 'checkbox' | 'blank';

export interface Message {
  title: string;
  text: string;
}

/** What a check says: fine, or not valid with the rule's alert style and message (null: use the default words). */
export type Verdict =
  { ok: true } | { ok: false; ruleId: string; alert: Alert; reason: Reason; message: Message | null };

/** A cell by position in the table's current order. */
export interface At {
  row: number;
  col: number;
}

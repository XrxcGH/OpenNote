// A signal read from a table (one on the open page, or pasted into the data field): the value column, and a time
// column whose even spacing sets the rate. Kept apart from signalInput.ts because the table reader is large and
// the signals worker does not need it: the tool reads the table, then hands the samples to the analysis.
import { columnNamed, completeRows } from '../../subjects/data/model';
import { readDataInput, type DataInput, type RoleValue } from '../../subjects/ui/input';
import { SignalError } from './errors';
import { timedSignal, type SignalText } from './signalInput';

/** The value column (and time column, when chosen) of the table, or null while no table or value column is set. */
export function tableSignal(table: DataInput, columns: RoleValue): SignalText | null {
  const value = typeof columns.response === 'string' ? columns.response : '';
  if (!table.text.trim() || !value) return null;
  const data = readDataInput(table);
  const time = typeof columns.time === 'string' && columns.time ? columns.time : '';
  const values = columnNamed(data, value);
  if (!values || (values.kind !== 'number' && values.kind !== 'date')) throw new SignalError('empty');
  const { rows } = completeRows(data, time ? [value, time] : [value]);
  const samples = rows.map((r) => values.values[r]!);
  if (!time) {
    if (samples.length === 0) throw new SignalError('empty');
    return { samples };
  }
  const times = columnNamed(data, time)!;
  if (times.kind !== 'number' && times.kind !== 'date') throw new SignalError('unevenTimes');
  // A date column counts in days (fractional with a time of day); the rate is per second either way.
  const scale = times.kind === 'date' ? 86_400 : 1;
  return timedSignal(
    rows.map((r) => times.values[r]! * scale),
    samples,
  );
}

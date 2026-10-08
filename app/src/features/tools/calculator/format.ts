// Turns a result into text. The formatter lives in the shared expression engine, so the calculator, Quick math, and
// smart tables all write numbers the same way. Thousands separators are left to the UI, which knows the locale.

export { formatNumber } from '../../../core/expr';
export type { FormatOptions, Notation } from '../../../core/expr';

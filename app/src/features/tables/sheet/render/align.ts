// Alignment (DESIGN 9). `General` decides by the kind of value: numbers and dates to the right, text to the left,
// booleans and errors in the middle.

import type { Align } from '../model';

export type ValueKind = 'empty' | 'text' | 'number' | 'date' | 'bool' | 'error';

const NUMBER = /^[-+(]?[$€£¥]?\s*\d[\d,]*(\.\d+)?(e[-+]?\d+)?\s*%?\)?$|^[-+]?\.\d+%?$/i;
const ERROR = /^#(N\/A|NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|SPILL!|CALC!|GETTING_DATA)$/i;

/** The kind of a value shown in a cell, from its text. A caller that knows better (the engine) passes the kind. */
export function kindOf(text: string): ValueKind {
  const t = text.trim();
  if (t === '') return 'empty';
  if (/^(true|false)$/i.test(t)) return 'bool';
  if (ERROR.test(t)) return 'error';
  if (NUMBER.test(t)) return 'number';
  return 'text';
}

const GENERAL: Record<ValueKind, string> = {
  empty: 'start',
  text: 'start',
  number: 'right',
  date: 'right',
  bool: 'center',
  error: 'center',
};

/** The `text-align` of a cell. */
export function textAlign(h: Align['h'], kind: ValueKind): string {
  switch (h) {
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'center':
    case 'centerAcross':
      return 'center';
    case 'justify':
    case 'distributed':
      return 'justify';
    case 'fill':
      return 'left';
    default:
      return GENERAL[kind];
  }
}

const VERTICAL = { top: 'top', middle: 'middle', bottom: 'bottom', justify: 'top', distributed: 'middle' } as const;

/** The `vertical-align` of a cell. */
export function verticalAlign(v: Align['v']): string {
  return v && Object.hasOwn(VERTICAL, v) ? VERTICAL[v] : 'top';
}

/** Whether a cell's text grows toward the left when it overflows: right-aligned text does. */
export function growsLeft(h: Align['h'], kind: ValueKind, rtl: boolean): boolean {
  const a = textAlign(h, kind);
  return a === 'right' || (rtl && a === 'start');
}

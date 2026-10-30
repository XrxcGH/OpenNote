// The instrumentation and measurement tool: one form with a mode for each everyday lab calculation.
import type { ToolSpec } from '../spec';
import type { KitOk, Values } from '../shared';
import { FIELDS, modeOf } from './fields';
import { bridge, colorCode, converter, rtd, signal, standardValue, thermocouple } from './modes';

const MODE: Record<string, (values: Values) => KitOk> = {
  color: colorCode,
  standard: standardValue,
  thermocouple,
  rtd,
  bridge,
  signal,
  adc: converter,
};

export const spec: ToolSpec = {
  id: 'instruments',
  fields: FIELDS,
  run: (values) => (MODE[modeOf(values)] ?? colorCode)(values),
};

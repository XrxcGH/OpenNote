// The script formatter: Fountain text laid out as a screenplay or stage play, with lists and breakdown sheets.
import type { ToolSpec } from '../spec';
import type { KitOk, Values } from '../shared';
import { FIELDS, mode } from './fields';
import { breakdownMode, charactersMode, classifyMode, formatMode, locationsMode, scenesMode } from './modes';

const RUN: Record<string, (v: Values) => KitOk> = {
  format: formatMode,
  classify: classifyMode,
  scenes: scenesMode,
  characters: charactersMode,
  locations: locationsMode,
  breakdown: breakdownMode,
};

export const spec: ToolSpec = {
  id: 'script',
  fields: FIELDS,
  run: (values) => (RUN[mode(values)] ?? formatMode)(values),
};

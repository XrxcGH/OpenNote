// The score block: write music in ABC notation, see it engraved, hear it, transpose it, and read it in other notations.
import type { ToolSpec } from '../spec';
import type { KitOk, Values } from '../shared';
import { FIELDS, mode } from './fields';
import { engrave, forPlayer, guitarTab, indian, numbered, transpose } from './modes';

const RUN: Record<string, (v: Values) => KitOk> = {
  engrave,
  transpose,
  instrument: forPlayer,
  jianpu: numbered,
  sargam: indian,
  tab: guitarTab,
};

export const spec: ToolSpec = {
  id: 'score',
  fields: FIELDS,
  run: (values) => (RUN[mode(values)] ?? engrave)(values),
};

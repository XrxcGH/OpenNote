// The music theory tool: intervals, scales from several traditions, chords, keys, Roman numerals, transposing
// instruments, pitch-class sets, twelve-tone rows, jazz, and guitar chord shapes.
import type { ToolSpec } from '../spec';
import type { KitOk, Values } from '../shared';
import { FIELDS, mode } from './fields';
import * as m from './modes';

const RUN: Record<string, (v: Values) => KitOk> = {
  interval: m.interval,
  above: m.above,
  pitch: m.pitch,
  scale: m.scale,
  melakarta: m.melakartaMode,
  cents: m.cents,
  chord: m.chordMode,
  name: m.nameMode,
  key: m.key,
  roman: m.roman,
  instrument: m.instrumentMode,
  pcset: m.pcset,
  row: m.rowMode,
  jazz: m.jazz,
  twofive: m.twoFive,
  guitar: m.guitar,
};

export const spec: ToolSpec = {
  id: 'theory',
  fields: FIELDS,
  run: (values) => (RUN[mode(values)] ?? m.interval)(values),
};

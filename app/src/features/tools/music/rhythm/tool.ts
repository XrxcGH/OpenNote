// The tuning and rhythm tool: tunings and temperaments in cents, the harmonic series, and rhythm from the metronome to
// Euclidean rhythms and the cycles of several traditions.
import type { ToolSpec } from '../spec';
import type { KitOk, Values } from '../shared';
import { FIELDS, mode } from './fields';
import { cycle, euclid, metronome, pattern, poly, tempoMode } from './rhythmModes';
import { beats, convert, edo, series, temperament } from './tuningModes';

const RUN: Record<string, (v: Values) => KitOk> = {
  convert,
  temperament,
  beats,
  series,
  edo,
  euclid,
  cycle,
  pattern,
  poly,
  tempo: tempoMode,
  metronome,
};

export const spec: ToolSpec = {
  id: 'rhythm',
  fields: FIELDS,
  run: (values) => (RUN[mode(values)] ?? convert)(values),
};

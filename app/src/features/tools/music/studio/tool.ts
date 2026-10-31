// The scale, color, and materials tool: scale drawings, color arithmetic, and checks, type scales, perspective grids,
// and fabric, sculpture, and glaze quantities.
import type { ToolSpec } from '../spec';
import type { KitOk, Values } from '../shared';
import { contrastMode, convert, difference, paletteMode, typeScaleMode, vision } from './colorModes';
import { FIELDS, mode } from './fields';
import { fabric, glazeMode, perspective, sculpture } from './makeModes';
import { cuts, enlarge, scale } from './sizeModes';

const RUN: Record<string, (v: Values) => KitOk> = {
  scale,
  enlarge,
  cutlist: cuts,
  convert,
  contrast: contrastMode,
  difference,
  vision,
  palette: paletteMode,
  typescale: typeScaleMode,
  perspective,
  yardage: fabric,
  sculpture,
  glaze: glazeMode,
};

export const spec: ToolSpec = {
  id: 'studio',
  fields: FIELDS,
  run: (values) => (RUN[mode(values)] ?? scale)(values),
};

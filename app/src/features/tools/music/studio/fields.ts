// checks-disable-file brand-consistency: color values are data here, not styling
// The studio tool's form: a mode choice and the fields each mode shows.
import { choice, only } from '../spec';
import type { Field } from '../spec';
import type { Values } from '../shared';

export const MODES = [
  ['scale', 'stuScale'],
  ['enlarge', 'stuEnlarge'],
  ['cutlist', 'stuCutList'],
  ['convert', 'stuConvert'],
  ['contrast', 'stuContrast'],
  ['difference', 'stuDifference'],
  ['vision', 'stuVision'],
  ['palette', 'stuPalette'],
  ['typescale', 'stuTypeScale'],
  ['perspective', 'stuPerspective'],
  ['yardage', 'stuYardage'],
  ['sculpture', 'stuSculpture'],
  ['glaze', 'stuGlaze'],
] as const satisfies readonly (readonly [string, string])[];

export const mode = (v: Values): string => v.mode ?? 'scale';
const on = (...modes: string[]) => only('mode', 'scale', ...modes);

const LENGTH_UNITS = [
  ['mm', 'stuMm'],
  ['cm', 'stuCm'],
  ['m', 'stuM'],
  ['in', 'stuIn'],
  ['ft', 'stuFt'],
] as const;

const SIZE_FIELDS: readonly Field[] = [
  { id: 'scaleText', label: 'stuScaleText', initial: '1:50', hint: 'stuScaleHint', when: on('scale') },
  { id: 'length', label: 'stuLength', initial: '3.5', when: on('scale') },
  choice('lengthUnit', 'stuLengthUnit', 'm', LENGTH_UNITS, on('scale')),
  choice(
    'direction',
    'stuDirection',
    'toDrawn',
    [
      ['toDrawn', 'stuToDrawn'],
      ['toReal', 'stuToReal'],
    ],
    on('scale'),
  ),
  choice('outUnit', 'stuOutUnit', 'mm', LENGTH_UNITS, on('scale')),
  { id: 'skW', label: 'stuSketchWidth', initial: '8', when: on('enlarge') },
  { id: 'skH', label: 'stuSketchHeight', initial: '10', when: on('enlarge') },
  { id: 'tgW', label: 'stuTargetWidth', initial: '48', when: on('enlarge') },
  { id: 'tgH', label: 'stuTargetHeight', initial: '60', when: on('enlarge') },
  { id: 'cell', label: 'stuGridCell', initial: '1', hint: 'stuGridHint', when: on('enlarge') },
  { id: 'stock', label: 'stuStock', initial: '96', when: on('cutlist') },
  { id: 'kerf', label: 'stuKerf', initial: '0.125', when: on('cutlist') },
  {
    id: 'cuts',
    label: 'stuCuts',
    initial: '48 x 2\n30 x 3\n24',
    kind: 'area',
    hint: 'stuCutsHint',
    when: on('cutlist'),
  },
];

const COLOR_FIELDS: readonly Field[] = [
  {
    id: 'color',
    label: 'stuColor',
    initial: '#e07a3f',
    hint: 'stuColorHint',
    when: on('convert', 'vision', 'palette'),
  },
  { id: 'fg', label: 'stuForeground', initial: '#767676', when: on('contrast') },
  { id: 'bg', label: 'stuBackground', initial: '#ffffff', when: on('contrast') },
  { id: 'colorA', label: 'stuColorA', initial: '#3b6ea5', when: on('difference') },
  { id: 'colorB', label: 'stuColorB', initial: '#4a78ad', when: on('difference') },
  choice(
    'harmony',
    'stuHarmony',
    'triadic',
    [
      ['complementary', 'stuComplementary'],
      ['analogous', 'stuAnalogous'],
      ['triadic', 'stuTriadic'],
      ['split', 'stuSplit'],
      ['tetradic', 'stuTetradic'],
      ['tints', 'stuTints'],
      ['shades', 'stuShades'],
    ],
    on('palette'),
  ),
  { id: 'tsBase', label: 'stuTypeBase', initial: '16', when: on('typescale') },
  { id: 'tsRatio', label: 'stuTypeRatio', initial: '1.25', hint: 'stuTypeRatioHint', when: on('typescale') },
  { id: 'tsDown', label: 'stuStepsDown', initial: '2', when: on('typescale') },
  { id: 'tsUp', label: 'stuStepsUp', initial: '5', when: on('typescale') },
];

const MAKE_FIELDS: readonly Field[] = [
  choice(
    'pKind',
    'stuPerspKind',
    'two',
    [
      ['one', 'stuOnePoint'],
      ['two', 'stuTwoPoint'],
      ['three', 'stuThreePoint'],
    ],
    on('perspective'),
  ),
  { id: 'pHorizon', label: 'stuHorizon', initial: '0.4', hint: 'stuHorizonHint', when: on('perspective') },
  { id: 'pLines', label: 'stuLines', initial: '8', when: on('perspective') },
  {
    id: 'pieces',
    label: 'stuPieces',
    initial: '20 x 30 x 4',
    kind: 'area',
    hint: 'stuPiecesHint',
    when: on('yardage'),
  },
  { id: 'fabric', label: 'stuFabricWidth', initial: '45', when: on('yardage') },
  choice(
    'nap',
    'stuNap',
    'no',
    [
      ['no', 'stuNoNap'],
      ['yes', 'stuYesNap'],
    ],
    on('yardage'),
  ),
  { id: 'repeat', label: 'stuRepeat', initial: '', hint: 'stuRepeatHint', when: on('yardage') },
  choice(
    'fabricUnit',
    'stuFabricUnit',
    'in',
    [
      ['in', 'stuIn'],
      ['cm', 'stuCm'],
    ],
    on('yardage'),
  ),
  choice(
    'shape',
    'stuShape',
    'block',
    [
      ['block', 'stuBlock'],
      ['cylinder', 'stuCylinder'],
      ['sphere', 'stuSphere'],
      ['volume', 'stuVolume'],
    ],
    on('sculpture'),
  ),
  { id: 'a', label: 'stuDimA', initial: '10', hint: 'stuDimHint', when: on('sculpture') },
  {
    id: 'b',
    label: 'stuDimB',
    initial: '10',
    when: (v) => on('sculpture')(v) && ['block', 'cylinder'].includes(v.shape ?? 'block'),
  },
  { id: 'c', label: 'stuDimC', initial: '10', when: (v) => on('sculpture')(v) && (v.shape ?? 'block') === 'block' },
  choice(
    'material',
    'stuMaterial',
    'marble',
    [
      ['water', 'stuWater'],
      ['aluminum', 'stuAluminum'],
      ['marble', 'stuMarble'],
      ['iron', 'stuIron'],
      ['bronze', 'stuBronze'],
      ['copper', 'stuCopper'],
      ['lead', 'stuLead'],
      ['typed', 'stuTypedDensity'],
    ],
    on('sculpture'),
  ),
  { id: 'density', label: 'stuDensity', initial: '2.7', when: (v) => on('sculpture')(v) && v.material === 'typed' },
  {
    id: 'recipe',
    label: 'stuRecipe',
    initial: 'Whiting: CaO.CO2 20\nSilica: SiO2 30\nKaolin: Al2O3.2SiO2.2H2O 20\nK-spar: K2O.Al2O3.6SiO2 30',
    kind: 'area',
    hint: 'stuRecipeHint',
    when: on('glaze'),
  },
  { id: 'batch', label: 'stuBatch', initial: '1000', hint: 'stuBatchHint', when: on('glaze') },
];

export const FIELDS: readonly Field[] = [
  choice('mode', 'stuMode', 'scale', MODES),
  ...SIZE_FIELDS,
  ...COLOR_FIELDS,
  ...MAKE_FIELDS,
];

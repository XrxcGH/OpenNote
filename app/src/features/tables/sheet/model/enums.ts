// The named values of `data.sheet` (format spec 6.3): border styles, fill patterns, look elements, operators,
// date periods, and icon sets.

export const BORDER_STYLES = [
  'thin',
  'medium',
  'thick',
  'hair',
  'dotted',
  'dashed',
  'mediumDashed',
  'dashDot',
  'mediumDashDot',
  'dashDotDot',
  'mediumDashDotDot',
  'slantDashDot',
  'double',
] as const;

export const PATTERNS = [
  'solid',
  'gray125',
  'gray0625',
  'lightGray',
  'mediumGray',
  'darkGray',
  'darkHorizontal',
  'darkVertical',
  'darkDown',
  'darkUp',
  'darkGrid',
  'darkTrellis',
  'lightHorizontal',
  'lightVertical',
  'lightDown',
  'lightUp',
  'lightGrid',
  'lightTrellis',
] as const;

export const BORDER_SIDES = ['t', 'r', 'b', 'l', 'du', 'dd'] as const;

export const LOOK_ELEMENTS = [
  'whole',
  'header',
  'total',
  'firstCol',
  'lastCol',
  'band1',
  'band2',
  'colBand1',
  'colBand2',
] as const;

export const OPS = [
  'between',
  'notBetween',
  'equal',
  'notEqual',
  'greater',
  'less',
  'greaterOrEqual',
  'lessOrEqual',
] as const;

export const PERIODS = [
  'yesterday',
  'today',
  'tomorrow',
  'last7Days',
  'lastWeek',
  'thisWeek',
  'nextWeek',
  'lastMonth',
  'thisMonth',
  'nextMonth',
];

export const ICON_SETS = [
  '3Arrows',
  '3Triangles',
  '3TrafficLights',
  '3Signs',
  '3Symbols',
  '3Flags',
  '3Stars',
  '4Arrows',
  '4Rating',
  '5Arrows',
  '5Rating',
  '5Quarters',
  '5Boxes',
];

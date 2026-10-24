// The tool kits' shared library, loaded with loadKits from features/tools (see README.md here). It holds the
// numerics, the air and water properties, the unit helpers, the kit window and its parts, the Insert menu, and the
// live calculation block. Tools in the tools feature may import these modules directly.
export * from './num/errors';
export * from './num/complex';
export * from './num/matrix';
export * from './num/poly';
export * from './num/roots';
export * from './num/quad';
export * from './num/ode';
export * from './num/special';
export * from './props/air';
export * from './props/water';
export * from './units';
export * from './types';
export * from './registry';
export { problemWords, say, stepWords, stepsText } from './ui/words';
export * from './problem';
export * from './ui/quantity';
export * from './ui/plot';
export * from './ui/diagram';
export * from './ui/palette';
export { el, px, svgDocument } from './ui/svg';
export * from './ui/insert';
export { ChoiceField, QuantityField, SystemToggle } from './ui/fields';
export type { ChoiceFieldProps, QuantityFieldProps } from './ui/fields';
export { Assumptions, MathLine, Problem, ResultTable, SourceNote, StepsView } from './ui/output';
export { KitPlot, plotSummary } from './ui/KitPlot';
export { InsertMenu, insertActions } from './ui/InsertMenu';
export type { InsertMenuProps } from './ui/InsertMenu';
export { KitWindow } from './ui/KitWindow';
export * from './block/model';
export { KitCalcView, mountKitCalc } from './block/KitCalcBlock';

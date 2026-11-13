// Conditional formatting (format spec R-SHT-15, DESIGN 13.5): rules that give styles, color scales, data bars, and
// icon sets, evaluated for each cell as the model resolves it.

export { conditionalLayer, drawnLayer, installConditional, barCss } from './layer';
export { ruleMatches, setToday, inPeriod, operandOf } from './match';
export type { RuleContext } from './match';
export { barOf, iconOf, scaleColor, levelOf, ICON_SETS } from './visual';
export type { Bar, Icon } from './visual';
export { mixLab, hexToLab, labToHex } from './oklab';
export { setFormulaEvaluator, simpleEvaluator, evaluateFormula } from './formula';
export type { FormulaContext, FormulaEvaluator } from './formula';
export { valueOfCell, readText } from './value';
export type { CellValue } from './value';
export { statsOf, percentile } from './stats';

// Ruled paper's math lives in core/ruled.ts, so print and export can use it without the page view: the rules, the
// snapping, and the measured font metric.
export { RULE_PROPERTIES, fontMetric, leadFor, ruleProperties, snapY, stepY, wholeRules } from '../../../core/ruled';
export type { RuleGrid } from '../../../core/ruled';

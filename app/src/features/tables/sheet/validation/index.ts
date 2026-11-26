// Data validation (ADR 0056, DESIGN 13.4): rules, checks, drop-down lists, edits, pastes, and circled invalid data.
export { CHOICE_RULE, check, compare, invalidCells, ruleAt } from './check';
export type { Found, Invalid } from './check';
export { applyEdit, applyPaste, decide } from './edit';
export type { Applied, Decision, Pasted } from './edit';
export { openList } from './list';
export { setValidationHost, validationHost } from './host';
export type { ValidationHost } from './host';
export type { ListOffer } from './list';
export { messageOf, sentenceOf } from './messages';
export { listItems, parseTime } from './operands';
export type { Alert, At, Context, Message, Reason, Verdict } from './types';

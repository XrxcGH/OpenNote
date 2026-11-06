// The sheet model of a table block (format spec 6.3, ADR 0056). It reads and writes `data.sheet`, interns and
// resolves cell styles, and applies formatting with Excel's row and column rules. It also keeps merges, rules,
// names, and the value cache.

export * from './types';
export { readSheet, writeSheet, orphans, dropOrphans, tidy, sheetPatch } from './sheet';
export { styleId, intern, gc, validStyle, styleById, usedStyles, STYLE_LIMIT, StyleLimitError } from './styles';
export { resolve, layer, lookElements, DEFAULT_STYLE } from './resolve';
export type { LookElement, NamedLook, ResolveHooks, Resolved, LayerName } from './resolve';
export { applyToRange, applyToRows, applyToColumns, applyToTable, changeStyle, clearProperties } from './apply';
export type { Applied } from './apply';
export { activeMerges, mergeAt, mergeSet, addMerge, removeMerge, repairMerges, MERGE_LIMIT, BoxIndex } from './merges';
export type { ActiveMerge, MergeRefusal, MergeSet } from './merges';
export {
  rangeBox,
  rulesOf,
  rulesAt,
  validationAt,
  applyOrder,
  setConditionalLayer,
  freeRuleId,
  setRule,
  removeRule,
  repairRanges,
  wholeTable,
  RULE_LIMIT,
} from './rules';
export type { Rule, RuleKind, ConditionalLayer } from './rules';
export { namesOf, findName, setName, deleteName, pageNames, lookupName, tableName, NAME_LIMIT } from './names';
export type { NamedRef, NameRefusal, PageName } from './names';
export {
  fingerprint,
  isFresh,
  readValues,
  valueAt,
  writeValues,
  cachedValue,
  formulaCells,
  readableText,
} from './cache';
export type { CachedValues } from './cache';
export { sheetProblems, styleProblems, isName } from './schema';
export { gridOf } from './grid';
export type { Box, Grid } from './grid';
export { canonical, fnv1a64 } from './json';

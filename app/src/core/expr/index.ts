// The shared expression engine: one tokenizer, one Pratt parser, one tree, and the tools that work on the tree.
// Pure TypeScript with no DOM and no React, so it runs in the app, in a worker, and in tests. The README in this
// folder says what each part does and what a screen needs to wire it up.

export { children, freeNames, MAX_TREE_DEPTH, sameTree, stripPositions, treeDepth, walk } from './ast';
export type {
  BinaryNode,
  BinaryOp,
  BoolNode,
  CallNode,
  CellNode,
  ColNode,
  Definition,
  Expression,
  NameNode,
  Node,
  NumNode,
  QuantityNode,
  PostfixNode,
  PostfixOp,
  RangeNode,
  Span,
  Statement,
  StrNode,
  UnaryNode,
  UnaryOp,
  UnitExpr,
  UnitFactor,
  ConvertNode,
} from './ast';
export * as build from './build';
export { dependsOn } from './build';
export { compileNode, finite, operation } from './compile';
export type { Compiled, CompileOptions } from './compile';
export { MATH_CONSTANTS, mathConstant } from './constants';
export { differentiate } from './derive';
export { BASE_LEX, setOf } from './dialect';
export type { Dialect, FunctionInfo } from './dialect';
export { asExprError, attempt, ExprError, pointAt } from './errors';
export type { ExprErrorCode, ExprProblem, Outcome } from './errors';
export { evaluateExact, exactFromNumber, exactToNumber } from './exact';
export type { ExactEnv, ExactValue } from './exact';
export { findFunction, standardFunctions } from './functions';
export type { FnDef, FunctionProfile, FunctionTable } from './functions';
export { evaluate, GENERAL, tryParse } from './general';
export type { EvaluateOptions } from './general';
export { canonicalNumberText, numberValue, tokenize } from './lexer';
export type { LexSpec, Token, TokenKind } from './lexer';
export { dropTrailingEquals, evaluateLines } from './lines';
export type { LineResult, LinesOptions } from './lines';
export { COMMON_ALIASES, functionLookup } from './lookup';
export type { FunctionNames } from './lookup';
export { amount, BASE_UNIT_NAMES, formatQuantity, fromAmount, NO_DIMENSION, resolveUnit, unitLabel } from './quantity';
export type { Dimension, Display, Quantity, UnitDef, UnitSystem } from './quantity';
export { evaluateQuantity } from './quantityEval';
export type { QuantityEnv, UserFunction } from './quantityEval';
export { formatUnit, isConvertToken, readUnitExpr } from './unitsyntax';
export { formatNumber } from './numfmt';
export type { FormatOptions, Notation } from './numfmt';
export { factorialExtended, gamma, realPower, snap } from './numeric';
export { parse, parseTokens } from './parser';
export { definitionHead, parseStatement } from './statement';
export { formatExpression, numberText } from './print';
export type { PrintOptions } from './print';
export * as fractions from './rational';
export type { DecimalText, Rational } from './rational';
export { columnFromLetters, lettersFromColumn, readCell, readColumn } from './refs';
export { sheetDialect } from './sheet';
export type { SheetSyntax } from './sheet';
export { simplify } from './simplify';
export type { AngleMode } from './trig';
export { rejectUnknown, splitWords } from './words';
export type { OnUnknown } from './words';

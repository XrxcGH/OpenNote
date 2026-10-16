// The paginator and sheet math for paginated page views: pure functions over page units, with no DOM.

export { paginate } from './paginate';
export { belowBreak, inkBounds, sheetCount, sheetPieces, sheetSpan, type SheetPiece, type SheetSpan } from './freeform';
export * from './geometry';
export type {
  BlockMeasure,
  Box,
  BreakPos,
  FlowBlock,
  Measure,
  PaginateOptions,
  Plan,
  PlanWarning,
  SheetBreak,
} from './types';

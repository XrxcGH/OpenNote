// The plan for a whole page: the flowing blocks paginated, the floating blocks placed on sheets, and the sheet count
// of both together. Print and export plan every page this way, whatever mode the screen shows.

import { MAX_SHEETS } from '../pagination/geometry';
import type { FlowBlock, Measure, PaginateOptions } from '../pagination/types';
import { floatingBySheet, planFloating, type FloatingItem, type FloatingPlan, type FloatingSlice } from './freeform';
import { planFlow, slicesBySheet, type FlowPlan, type FlowSlice } from './flow';
import type { PageLayout } from './page';

export interface PageContent {
  /** The flowing blocks in reading order, with the measure of each. Empty for a freeform page. */
  readonly flow?: { readonly blocks: readonly FlowBlock[]; readonly measure: Measure };
  /** Floating blocks and the ink layer, as boxes in page coordinates. */
  readonly floating?: readonly FloatingItem[];
  readonly options?: PaginateOptions;
}

export interface SheetPlan {
  readonly index: number;
  readonly flow: readonly FlowSlice[];
  readonly floating: readonly FloatingSlice[];
}

export interface PagePlan {
  /**
   * The sheets the page needs, at least 1: the larger of what the flow and the floating blocks need, up to
   * MAX_SHEETS.
   */
  readonly sheets: number;
  /** The sheets the page would need past MAX_SHEETS, which are left out. Zero for any real page. */
  readonly cut: number;
  readonly flow: FlowPlan | null;
  readonly floating: FloatingPlan;
  readonly bySheet: readonly SheetPlan[];
}

export function planPage(layout: PageLayout, content: PageContent): PagePlan {
  const items = content.floating ?? [];
  const flow = content.flow
    ? planFlow(layout.flowSheet, content.flow.blocks, content.flow.measure, content.options)
    : null;
  const floating = planFloating(layout.sheet, items);
  const needed = Math.max(1, flow?.plan.sheets ?? 1, floating.sheets);
  // A block far down the page must not make the plan, and the print document after it, millions of sheets long.
  const sheets = Math.min(needed, MAX_SHEETS);
  const flowSlices = flow ? slicesBySheet(flow, sheets) : [];
  const floatSlices = floatingBySheet(layout.sheet, items, sheets);
  const bySheet = Array.from({ length: sheets }, (_, index) => ({
    index,
    flow: flowSlices[index] ?? [],
    floating: floatSlices[index] ?? [],
  }));
  return { sheets, cut: needed - sheets, flow, floating, bySheet };
}

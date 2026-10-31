// The statistics kit as a kit-foundation KitDef: one tab for each tool, each loading the first time it opens.
import { lazy } from 'react';
import type { KitDef, KitToolDef } from '../kits/types';
import { STAT_KIT_ID, STAT_TOOLS, type StatTool } from './meta';

const BODIES: Record<StatTool, KitToolDef['Component']> = {
  describe: lazy(() => import('./describe/Tool')),
  power: lazy(() => import('./power/Tool')),
  groups: lazy(() => import('./groups/Tool')),
  bayes: lazy(() => import('./bayes/Tool')),
  design: lazy(() => import('./design/Tool')),
  resample: lazy(() => import('./resample/Tool')),
  multiple: lazy(() => import('./multiple/Tool')),
  ranks: lazy(() => import('./ranks/Tool')),
  correlation: lazy(() => import('./correlation/Tool')),
  epi: lazy(() => import('./epi/Tool')),
  tables: lazy(() => import('./tables/Tool')),
};

export const STAT_KIT: KitDef = {
  id: STAT_KIT_ID,
  title: 'kitStatInfer.window.title',
  tools: STAT_TOOLS.map(([id, icon]) => ({
    id,
    title: `kitStatInfer.tools.${id}`,
    keywords: `kitStatInfer.keywords.${id}`,
    icon,
    Component: BODIES[id],
  })),
};

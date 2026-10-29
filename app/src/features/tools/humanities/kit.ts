// The kit's tool bodies, each loaded the first time it is shown, so one tool's code and data never slow another.
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { HumanitiesToolId } from './meta';

export const TOOL_BODIES: Record<HumanitiesToolId, LazyExoticComponent<ComponentType>> = {
  frames: lazy(() => import('./frames/FramesTool').then((module) => ({ default: module.FramesTool }))),
  coordinates: lazy(() =>
    import('./coordinates/CoordinatesTool').then((module) => ({ default: module.CoordinatesTool })),
  ),
  timeline: lazy(() => import('./timeline/TimelineTool').then((module) => ({ default: module.TimelineTool }))),
  calendars: lazy(() => import('./calendars/CalendarsTool').then((module) => ({ default: module.CalendarsTool }))),
  keys: lazy(() => import('./keys/KeysTool').then((module) => ({ default: module.KeysTool }))),
};

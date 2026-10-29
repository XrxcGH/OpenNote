// The tools the modern physics window lists. Each tool's forms and engine load the first time it is shown.
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { ModPhysToolId } from './meta';

export const KIT: Record<ModPhysToolId, LazyExoticComponent<ComponentType>> = {
  plasma: lazy(() => import('./plasma/Tool')),
  stars: lazy(() => import('./stars/Tool')),
  cosmos: lazy(() => import('./cosmos/Tool')),
  spin: lazy(() => import('./spin/Tool')),
  atoms: lazy(() => import('./atoms/Tool')),
  molecules: lazy(() => import('./molecules/Tool')),
  sky: lazy(() => import('./sky/Tool')),
  solids: lazy(() => import('./solids/Tool')),
};

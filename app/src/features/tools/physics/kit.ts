// The physics kit: each tool's tab title and its component, which loads the first time the tab opens.
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import type { MessageKey } from '../../../strings/t';
import type { KitToolProps } from './kit/types';
import { PHYSICS_TOOLS } from './meta';
import type { PhysicsToolId } from './meta';

export interface KitToolDef {
  id: PhysicsToolId;
  title: MessageKey;
  icon: string;
  Component: LazyExoticComponent<ComponentType<KitToolProps>>;
}

type Loader = () => Promise<{ default: ComponentType<KitToolProps> }>;

const LOADERS: Record<PhysicsToolId, Loader> = {
  waves: () => import('./waves/Tool'),
  relativity: () => import('./relativity/Tool'),
  waveoptics: () => import('./waveoptics/Tool'),
};

export const PHYSICS_KIT: { id: 'physics'; tools: readonly KitToolDef[] } = {
  id: 'physics',
  tools: (PHYSICS_TOOLS as readonly { id: PhysicsToolId; icon: string }[]).map((tool) => ({
    id: tool.id,
    title: `kitPhysics.${tool.id}.title` as MessageKey,
    icon: tool.icon,
    Component: lazy(LOADERS[tool.id]),
  })),
};

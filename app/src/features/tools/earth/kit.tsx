// The earth kit's tool bodies: one lazy component per tool, each a calculation picker over its forms.
import { lazy } from 'react';
import type { ComponentType, LazyExoticComponent } from 'react';
import { MODE_LOADERS } from './loaders';
import { EARTH_TOOL_IDS } from './meta';
import type { EarthToolId } from './meta';
import { ModeTool } from './ui/ModeTool';

export const KIT = Object.fromEntries(
  EARTH_TOOL_IDS.map((id) => [
    id,
    lazy(() =>
      MODE_LOADERS[id]().then((modes) => ({
        default: function Tool() {
          return <ModeTool tool={id} modes={modes} />;
        },
      })),
    ),
  ]),
) as Record<EarthToolId, LazyExoticComponent<ComponentType>>;

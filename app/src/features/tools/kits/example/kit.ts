// The example kit: one tool, the ideal gas law, that README.md walks through and the kit window's tests use. It is
// not registered in the app (the chemistry tools already have gas laws); a subject kit's kit.ts looks just like it.
import { lazy } from 'react';
import type { KitDef } from '../types';

export const EXAMPLE_KIT: KitDef = {
  id: 'example',
  title: 'kits.example.title',
  tools: [
    {
      id: 'idealGas',
      title: 'kits.example.title',
      keywords: 'kits.example.keywords',
      icon: 'Flask',
      Component: lazy(() => import('./idealGas/IdealGasTool')),
    },
  ],
};

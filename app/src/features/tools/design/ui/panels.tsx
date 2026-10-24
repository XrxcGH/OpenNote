// The body of each tool, loaded the first time its tab opens. A calculating tool is a spec the shared panel draws;
// the others (the drafting sheet, the tracer, and so on) are components of their own.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';
import type { ToolSpec } from '../kit/spec';
import { SPECS } from '../specs';
import { ToolPanel } from './ToolPanel';

function specPanel(tool: string, load: () => Promise<ToolSpec>): LazyExoticComponent<ComponentType> {
  return lazy(async () => {
    const spec = await load();
    return { default: () => <ToolPanel tool={tool} spec={spec} /> };
  });
}

const OWN: Record<string, LazyExoticComponent<ComponentType>> = {
  references: lazy(() => import('./ReferencesTool')),
  views: lazy(() => import('./ViewsTool')),
};

export const PANELS: Record<string, LazyExoticComponent<ComponentType>> = {
  ...Object.fromEntries(Object.entries(SPECS).map(([tool, load]) => [tool, specPanel(tool, load)])),
  ...OWN,
};

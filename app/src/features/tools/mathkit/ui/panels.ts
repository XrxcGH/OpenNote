// The body of each tool, loaded the first time its tab is shown so the window itself stays small.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export const PANELS: Readonly<Record<string, LazyExoticComponent<ComponentType>>> = {
  series: lazy(() => import('../series/SeriesTool')),
  complex: lazy(() => import('../complex/ComplexTool')),
  odes: lazy(() => import('../odesystems/OdeTool')),
  fourier: lazy(() => import('../fourierpde/FourierTool')),
  numerics: lazy(() => import('../numerics/NumericsTool')),
  console: lazy(() => import('../matrixconsole/MatrixConsoleTool')),
  linalg: lazy(() => import('../linalg/LinalgTool')),
  vectorcalc: lazy(() => import('../vectorcalc/VectorTool')),
};

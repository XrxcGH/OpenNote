// Test hooks for the ink benchmark (docs/perf/phase-5.md). Only `vite build --mode test` builds have them, as
// window.__OPENNOTE_TEST__.inkSeed and inkStats: seed the shown page with a generated page of strokes, and read
// how many strokes and tiles the view holds.
import { newId } from '../../../editor/ids';
import { generatePage } from '../geometry/fixtures';
import type { InkStroke } from '../model/types';
import type { InkSurface } from './surface';

export function installInkTestHooks(surfaceOf: () => InkSurface | null): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') return;
  const hooks = (window.__OPENNOTE_TEST__ ??= {});
  hooks.inkSeed = async (count: number, width: number, height: number) => {
    const surface = surfaceOf();
    if (!surface) return 0;
    const block = surface.layerFor();
    const strokes = generatePage(count, 42, width, height).strokes.map((stroke): InkStroke => ({
      ...stroke,
      id: newId(),
      block,
      slot: 1,
      color: [43, 37, 33, 255],
    }));
    return (await surface.add(strokes)) ? strokes.length : 0;
  };
  hooks.inkStats = () => {
    const surface = surfaceOf();
    return surface ? { strokes: surface.index.size, warming: surface.warmingLeft, ...surface.tiles.stats() } : null;
  };
}

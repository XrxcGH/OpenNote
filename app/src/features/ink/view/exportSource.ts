// Ink for Phase 6's print and export: the shown page's live strokes, read from the page service as segment records
// (the core's page_read_strokes in the app), so a PDF or a picture has the drawing as the notebook stores it.
import { exportInkSources } from '../../../registries';
import type { InkSurface } from './surface';

/** Registers the shown page's ink with export. Returns the function that takes it back. */
export function registerExportStrokes(surfaceOf: () => InkSurface | null): () => void {
  return exportInkSources.register({
    id: 'ink',
    async records(pageId) {
      const page = surfaceOf()?.parts.page;
      if (!page?.ink || page.id !== pageId) return null;
      return page.ink.readAll();
    },
  });
}

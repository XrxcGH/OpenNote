// Ink for Phase 6's print and export: the shown page's live strokes, read from the page service as segment records
// (the core's page_read_strokes in the app), so a PDF or a picture has the drawing as the notebook stores it.
import { decodeRecords } from '../../../core/ink/codec';
import { exportStrokes, exportStrokeSources } from '../../pages';
import type { InkSurface } from './surface';

/** Registers the shown page's ink with export. Returns the function that takes it back. */
export function registerExportStrokes(surfaceOf: () => InkSurface | null): () => void {
  return exportStrokeSources.register({
    id: 'ink',
    async strokes(pageId) {
      const page = surfaceOf()?.parts.page;
      if (!page?.ink || page.id !== pageId) return [];
      return exportStrokes(decodeRecords(await page.ink.readAll(), { verify: false }));
    },
  });
}

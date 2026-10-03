// Where export gets a page's handwriting. The pages feature doesn't know how ink is stored: Phase 5's ink feature
// registers a source that returns the live strokes of a page in page units, and export draws them as vector shapes.
import { createRegistry } from '../../../registries';
import type { ExportStroke } from '../export';

export interface ExportStrokeSource {
  readonly id: string;
  /** The strokes of one page, as they are now. */
  strokes(pageId: string): Promise<readonly ExportStroke[]>;
}

export const exportStrokeSources = createRegistry<ExportStrokeSource>('export stroke sources');

/** Every registered source's strokes for a page. A source that fails leaves its strokes out. */
export async function collectStrokes(pageId: string): Promise<ExportStroke[]> {
  const lists = await Promise.all(
    exportStrokeSources.list().map((source) => source.strokes(pageId).catch(() => [] as readonly ExportStroke[])),
  );
  return lists.flat();
}

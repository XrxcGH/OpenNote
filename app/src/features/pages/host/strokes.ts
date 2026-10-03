// Where export gets a page's handwriting. The pages feature doesn't know how ink is kept: Phase 5's ink view registers
// an export ink source (registries) that returns a page's live strokes as segment records, and export decodes them
// into page units and draws them as vector shapes.
import { decodeRecords } from '../../../core/ink/codec';
import { exportInkSources } from '../../../registries';
import { exportStrokes, type ExportStroke } from '../export';

/** Every registered source's strokes for a page. A source that fails, or holds records that can't be read, adds none. */
export async function collectStrokes(pageId: string): Promise<ExportStroke[]> {
  const lists = await Promise.all(
    exportInkSources.list().map(async (source) => {
      try {
        const records = await source.records(pageId);
        return records ? exportStrokes(decodeRecords(records, { verify: false })) : [];
      } catch {
        return [];
      }
    }),
  );
  return lists.flat();
}

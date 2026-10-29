// A small builder for pages in tests: give it the blocks and it returns an `ExportPage`, as `readExportPage` reads it.

import { readExportPage, type ExportPage, type ExportStroke } from '../export/source';
import type { Json, JsonObject } from '../layout/json';

export interface BlockSpec {
  readonly id?: string;
  readonly type: string;
  readonly data: JsonObject;
  readonly frame?: JsonObject;
}

export interface BuildOptions {
  readonly view?: JsonObject;
  readonly assets?: Record<string, Json>;
  readonly strokes?: readonly ExportStroke[];
  readonly title?: string;
}

/** A text block spec. */
export const textBlock = (markdown: string, frame?: JsonObject, id?: string): BlockSpec => ({
  id,
  type: 'text',
  data: { markdown },
  frame,
});

/** A page of the given blocks, in order, with ids `b1`, `b2`, and so on unless the spec names one. */
export function pageOf(blocks: readonly BlockSpec[], options: BuildOptions = {}): ExportPage {
  return readExportPage(
    {
      id: 'page',
      title: options.title ?? 'Test page',
      created: '2026-10-01T10:00:00.000Z',
      modified: '2026-10-01T10:00:00.000Z',
      tags: [],
      assets: options.assets ?? {},
      view: options.view ?? { layout: 'flow', mode: 'paginated' },
      blocks: blocks.map((b, i) => ({
        id: b.id ?? `b${i + 1}`,
        type: b.type,
        order: `a${String(i).padStart(5, '0')}`,
        data: b.data,
        ...(b.frame ? { frame: b.frame } : {}),
      })),
    },
    options.strokes ?? [],
    'en',
  );
}

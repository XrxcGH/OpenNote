// Ink for Phase 6's print and export: the shown page's live strokes, read from the page service as segment records
// (the core's page_read_strokes in the app), so a PDF or a picture has the drawing as the notebook stores it.
import { decodeRecords, encodeRecords } from '../../../core/ink/codec';
import { exportInkSources } from '../../../registries';
import { excludedFromExport, inkLayers } from './layers';
import type { InkSurface } from './surface';

/** Set while a single layer is exported on its own (the Layers dialog's Export layer). */
let onlyLayer: string | undefined;
export function exportOnlyLayer(layer: string | undefined): void {
  onlyLayer = layer;
}

/**
 * The records an export or print gets: without the strokes of hidden layers, and with `onlyLayer` only that layer's.
 * A page with a single layer is returned untouched.
 */
export function layerRecords(bytes: Uint8Array): Uint8Array {
  const layers = inkLayers.get();
  if (layers.order.length < 2 && onlyLayer === undefined) return bytes;
  const records = decodeRecords(bytes, { verify: false });
  const strokes = records.flatMap((record) => (record.kind === 'stroke' ? [record.stroke] : []));
  const drop = excludedFromExport(
    layers,
    strokes.map((stroke) => ({ id: stroke.id, origin: stroke.origin ?? undefined })),
    onlyLayer,
  );
  if (drop.size === 0) return bytes;
  return encodeRecords(records.filter((record) => record.kind !== 'stroke' || !drop.has(record.stroke.id)));
}

/** Registers the shown page's ink with export. Returns the function that takes it back. */
export function registerExportStrokes(surfaceOf: () => InkSurface | null): () => void {
  return exportInkSources.register({
    id: 'ink',
    async records(pageId) {
      const page = surfaceOf()?.parts.page;
      if (!page?.ink || page.id !== pageId) return null;
      return layerRecords(await page.ink.readAll());
    },
  });
}

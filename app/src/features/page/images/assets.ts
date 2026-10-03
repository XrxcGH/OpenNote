// The asset table an image block reads its size from (Phase 4 ARCHITECTURE.md section 12.3). It starts with the
// page's assets, gains each import, and follows undo and other windows through the page's frames, so an image's
// `width` and `height` are known before it loads and layout never shifts.
import type { AssetId, AssetJson, OpenPage } from '../../../services/pages/types';

export interface AssetTable {
  get(id: AssetId): AssetJson | null;
  add(id: AssetId, asset: AssetJson): void;
  /** Calls back when an asset arrives or goes, for blocks that showed a placeholder. */
  onChange(listener: (id: AssetId) => void): () => void;
}

const tables = new WeakMap<OpenPage, AssetTable>();

export function assetTable(page: OpenPage): AssetTable {
  const found = tables.get(page);
  if (found) return found;
  const assets = new Map<AssetId, AssetJson>(Object.entries(page.initial.assets ?? {}));
  const listeners = new Set<(id: AssetId) => void>();
  const changed = (id: AssetId) => listeners.forEach((listener) => listener(id));
  page.onFrame((frame) => {
    for (const [id, asset] of Object.entries(frame.assets)) {
      if (asset) assets.set(id, asset);
      else assets.delete(id);
      changed(id);
    }
  });
  const table: AssetTable = {
    get: (id) => assets.get(id) ?? null,
    add(id, asset) {
      assets.set(id, asset);
      changed(id);
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  tables.set(page, table);
  return table;
}

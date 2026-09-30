// Turns the in-memory library into the Phase 2 snapshot and back (services/notes/snapshot.ts), Trash included.

import type { FixtureNode } from '../fixtures';
import type { SnapshotData, SnapshotTrashItem } from '../snapshot';
import { Library } from './library';

export function toSnapshot(lib: Library): SnapshotData {
  return {
    folder: lib.folder,
    ...(lib.readOnly && { readOnly: true }),
    notebooks: lib.kidsOf(null).map((id) => lib.toFixture(id)),
    trash: lib.records.map((record): SnapshotTrashItem => ({
      receiptId: record.receiptId,
      trashedAt: record.trashedAt,
      parentId: record.parentId,
      beforeId: record.beforeId,
      parentTitle: record.parentTitle,
      notebookId: record.notebookId,
      nodes: record.ids.map((id) => lib.toFixture(id)),
    })),
  };
}

const allIds = (nodes: readonly FixtureNode[]): string[] =>
  nodes.flatMap((node) => [node.id, ...allIds(node.children ?? [])]);

/** A library from a seed or a snapshot. Trash items whose ids clash with others are dropped. */
export function fromSnapshot(data: SnapshotData): Library {
  const lib = new Library(data);
  for (const item of data.trash ?? []) {
    if (allIds(item.nodes).some((id) => lib.nodes.has(id))) continue;
    const held: string[] = [];
    lib.seed(item.nodes, item.parentId, held);
    for (const id of held.flatMap((root) => lib.subtree(root))) lib.trashed.add(id);
    lib.records.push({
      receiptId: item.receiptId,
      ids: held,
      parentId: item.parentId,
      beforeId: item.beforeId,
      parentTitle: item.parentTitle,
      notebookId: item.notebookId,
      trashedAt: item.trashedAt,
    });
  }
  return lib;
}

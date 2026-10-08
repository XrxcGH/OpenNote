// What a problem code from the core means in plain words: a damaged file, a missing file (an image, a recording,
// or ink), or a problem in the notebook own tree files. The core codes are stable (store/verify).

export type Category = 'damaged' | 'missing' | 'tree' | 'other';

const MISSING = new Set([
  'asset.name',
  'history.assetMissing',
  'history.segmentMissing',
  'history.snapshotMissing',
  'trash.contentMissing',
]);

const TREE = new Set([
  'tree.duplicatePage',
  'tree.duplicateSection',
  'tree.entryWithoutFolder',
  'tree.folderWithoutEntry',
  'tree.pendingMove',
  'section.folderName',
]);

const DAMAGED = new Set([
  'file.unreadable',
  'folder.unreadable',
  'asset.checksum',
  'page.invalid',
  'section.invalid',
  'notebook.invalid',
  'segment.damaged',
  'segment.invalid',
  'stroke.block',
  'history.invalid',
  'trash.invalid',
  'conflict.invalid',
]);

export function categoryOf(code: string): Category {
  if (MISSING.has(code)) return 'missing';
  if (TREE.has(code)) return 'tree';
  if (DAMAGED.has(code)) return 'damaged';
  return 'other';
}

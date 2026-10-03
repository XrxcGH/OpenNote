// Attached files (FEATURES.md, Attachments that save back): the logic with no page in it. An attachment is a `file`
// block that names an asset of the page. Opening one edits a copy in its own app; each change that app saves comes
// back as a new asset, and the block is pointed at it in one step, so the page always holds the latest version and
// undo brings back the one before.
import type { AttachmentSaved } from '../../../platform/types';
import type { BlockJson, Edit } from '../../../services/pages/types';

export type FileFamily = 'word' | 'excel' | 'powerpoint' | 'pdf' | 'text' | 'audio' | 'video' | 'archive' | 'other';

export interface FileKind {
  /** The short label on the icon, such as "DOCX". */
  label: string;
  family: FileFamily;
}

const FAMILIES: Readonly<Record<string, FileFamily>> = {
  doc: 'word',
  docx: 'word',
  dot: 'word',
  dotx: 'word',
  odt: 'word',
  rtf: 'word',
  xls: 'excel',
  xlsx: 'excel',
  xlsm: 'excel',
  csv: 'excel',
  ods: 'excel',
  ppt: 'powerpoint',
  pptx: 'powerpoint',
  odp: 'powerpoint',
  pdf: 'pdf',
  txt: 'text',
  md: 'text',
  json: 'text',
  log: 'text',
  xml: 'text',
  mp3: 'audio',
  wav: 'audio',
  m4a: 'audio',
  flac: 'audio',
  ogg: 'audio',
  mp4: 'video',
  mov: 'video',
  mkv: 'video',
  webm: 'video',
  zip: 'archive',
  '7z': 'archive',
  rar: 'archive',
  gz: 'archive',
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : '';
}

/** The icon label and family of a file. */
export function fileKind(name: string): FileKind {
  const extension = extensionOf(name);
  return { label: extension ? extension.slice(0, 5).toUpperCase() : 'FILE', family: FAMILIES[extension] ?? 'other' };
}

/** Files that are plain text, which a preview can show as lines. */
export function isTextual(name: string, mime: string): boolean {
  return mime.startsWith('text/') || mime === 'application/json' || FAMILIES[extensionOf(name)] === 'text';
}

/** A size for people: "24 KB", "1.5 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1000;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  return `${value >= 100 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

/** The first lines of a text preview, cut to what fits in a card. */
export function previewLines(text: string, lines = 8, width = 90): string {
  return text
    .split(/\r?\n/)
    .slice(0, lines)
    .map((line) => (line.length > width ? `${line.slice(0, width - 1)}…` : line))
    .join('\n');
}

/**
 * The edits that point attachments at the new version an app saved: add the new asset, repoint every file block that
 * named the old one, and drop the old asset unless another block still uses it. Null when no file block names it.
 */
export function savedBackEdits(blocks: readonly BlockJson[], saved: AttachmentSaved): Edit[] | null {
  const assetOf = (block: BlockJson) => (typeof block.data.asset === 'string' ? block.data.asset : null);
  const pointing = blocks.filter((block) => block.type === 'file' && assetOf(block) === saved.previous);
  if (pointing.length === 0) return null;
  const edits: Edit[] = [{ edit: 'addAsset', asset: saved.asset.id }];
  for (const block of pointing) {
    edits.push({ edit: 'patchBlock', block: block.id, data: { asset: saved.asset.id } });
  }
  const others = blocks.some((block) => !pointing.includes(block) && assetOf(block) === saved.previous);
  if (!others) edits.push({ edit: 'removeAsset', asset: saved.previous });
  return edits;
}

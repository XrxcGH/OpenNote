// Phase 3's binary answers (crates/core/src/wire): the page envelope that page_open returns, and the applied-changes
// frame of undo and redo. Numbers are little-endian, as everywhere in the format.

/** The session part of an envelope (crates/core/src/wire/envelope.rs, SessionInfo). */
export interface SessionInfo {
  page: string;
  revision: string;
  clientSeq: number;
  readOnly: string | null;
  canUndo: boolean;
  canRedo: boolean;
  saved: boolean;
  conflicts: string[];
  damagedStrokes: number;
  missingFiles: number;
  strokesTotal: number;
}

export interface DecodedEnvelope {
  session: SessionInfo;
  /** The page's page.json. */
  page: Record<string, unknown>;
  readOnly: boolean;
  moreInk: boolean;
  strokes: number;
  /** The live stroke records, for Phase 5. */
  ink: Uint8Array;
}

/** The JSON part of a frame (crates/core/src/wire/frames.rs, FrameInfo). */
export interface FrameInfo {
  seq: number;
  changes: { pageFields: boolean; blocksChanged: string[]; blocksRemoved: string[]; assetsChanged: string[] };
  ui: unknown;
  texts: Record<string, string>;
  blocks: Record<string, unknown>[];
  title: string | null;
  tags: string[] | null;
  view: Record<string, unknown> | null;
  assets: (Record<string, unknown> & { id: string })[];
  canUndo: boolean;
  canRedo: boolean;
  strokes: number;
}

const HEADER = 24;
const decoder = new TextDecoder();
const padded = (length: number) => Math.ceil(length / 8) * 8;

export function decodeEnvelope(buffer: ArrayBuffer): DecodedEnvelope {
  const view = new DataView(buffer);
  const magic = decoder.decode(new Uint8Array(buffer, 0, 4));
  if (buffer.byteLength < HEADER || magic !== 'ONPE') throw new Error('The page envelope is damaged.');
  const flags = view.getUint16(6, true);
  const sessionLength = view.getUint32(8, true);
  const pageLength = view.getUint32(12, true);
  const inkLength = view.getUint32(16, true);
  const strokes = view.getUint32(20, true);
  const pageAt = HEADER + padded(sessionLength);
  const inkAt = pageAt + padded(pageLength);
  return {
    session: JSON.parse(decoder.decode(new Uint8Array(buffer, HEADER, sessionLength))) as SessionInfo,
    page: JSON.parse(decoder.decode(new Uint8Array(buffer, pageAt, pageLength))) as Record<string, unknown>,
    readOnly: (flags & 1) !== 0,
    moreInk: (flags & 2) !== 0,
    strokes,
    ink: new Uint8Array(buffer, inkAt, inkLength),
  };
}

export function decodeFrame(buffer: ArrayBuffer): FrameInfo {
  const length = new DataView(buffer).getUint32(0, true);
  return JSON.parse(decoder.decode(new Uint8Array(buffer, 4, length))) as FrameInfo;
}

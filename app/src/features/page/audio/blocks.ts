// Reading and writing the shown page's recordings (Phase 9). A recording sits on the page as a block of type
// `ext:org.opennote/recording`, whose data only names the recording. The core can't edit a block of a type it doesn't
// know, so the entry, which changes as the recording runs, is kept in the page's view under `recordings`
// (crates/media/src/README.md, "What the note format needs"). Every change to an entry is a `setPage` step.
import { commandContext } from '../../../commands/registry';
import { enhancedTracks } from '../../../core/audio';
import type { RecordingEntry } from '../../../core/audio';
import { newId } from '../../../editor/ids';
import type { BlockId, BlockJson, Edit, Frame, NewBlock, TxnAck } from '../../../services/pages/types';
import { shownPage as shownOpenPage } from '../history/shown';
import { shownLayer } from '../mount';
import { shownPool } from '../pool/shown';
import { pagesClient } from '../runtime';
import type { SyncQueue } from '../sync';
import { shownQueue } from '../sync/shown';
import { entryOf, removeEntry, setEntries } from './entries';
import { fallbackFor } from './entry';
import { RECORDING_TYPE } from './state';

export { activeNs, dataOf, fallbackFor, recordingIdOf } from './entry';

/** The core takes a fallback on a new block, which a block of a type it doesn't know needs; the type here omits it. */
type NewRecordingBlock = NewBlock & { fallback: BlockJson['fallback'] };
type InsertEdit = { edit: 'insertBlock'; block: NewRecordingBlock; after?: BlockId; before?: BlockId };

/** The recording blocks of the shown page, in reading order. */
export function recordingBlocks(): readonly BlockJson[] {
  return (shownLayer.get()?.blocks() ?? []).filter((block) => block.type === RECORDING_TYPE);
}

export function pageId(): string | null {
  return shownOpenPage.get()?.id ?? null;
}

/**
 * The step that saves an entry in the page's view. A member the entry lacks is sent as null, which removes it, so
 * the last flag going takes `flags` with it.
 */
function entryEdit(entry: RecordingEntry): Edit {
  // The members a screen adds are sent as null when the entry lacks them, which removes them.
  const gone = { flags: null, enhanced: null, listen: null, transcribeWith: null, audioRemoved: null, snaps: null };
  return { edit: 'setPage', view: { recordings: { [entry.id]: { ...gone, ...entry } } } };
}

/** Which of an entry's tracks the page's asset table must list, for a host that keeps them as assets. */
export interface TrackChange {
  /**
   * The entry's tracks are new or changed: the table lists them, and a growing one is replaced. `growing` says the
   * files are still being written; `finished` that they are closed.
   */
  track?: 'growing' | 'finished';
  /** The entry this one replaces: its tracks, and those of its enhanced copy, leave the table. */
  drop?: RecordingEntry;
  /** The entry's enhanced copy is new: the table lists its tracks too. */
  enhanced?: boolean;
}

/** The steps that save an entry, and keep the page's asset table in step with its tracks. */
async function entryEdits(page: string, entry: RecordingEntry, change: TrackChange = {}): Promise<Edit[]> {
  const edits = [entryEdit(entry)];
  const audio = commandContext('commandBar').platform.audio;
  if (!audio.keepsAssets) return edits;
  const dropped = change.drop ? [...change.drop.tracks, ...enhancedTracks(change.drop)] : [];
  for (const track of dropped) edits.push({ edit: 'removeAsset', asset: track.asset });
  // The page must hold the tracks before the edit that lists them.
  if (change.track) {
    await audio.adoptTracks(await audio.assetsDir(page), entry, change.track === 'growing');
    for (const track of entry.tracks) edits.push({ edit: 'addAsset', asset: track.asset });
  }
  const copy = enhancedTracks(entry);
  if (change.enhanced && copy.length > 0) {
    await audio.adoptTracks(await audio.assetsDir(page), { ...entry, tracks: copy }, false);
    for (const track of copy) edits.push({ edit: 'addAsset', asset: track.asset });
  }
  return edits;
}

function insertEdit(id: BlockId, entry: RecordingEntry, anchor?: BlockId): InsertEdit {
  const layer = shownLayer.get();
  const from = anchor ?? shownPool.get()?.active()?.block ?? null;
  const source = from && layer?.view(from);
  const floating = Boolean(source && source.element.style.left !== '');
  let frame: Frame | undefined;
  if (source && floating) {
    const rect = source.measure();
    frame = { x: rect.x, y: rect.y + rect.h + 16 };
  }
  const blocks = layer?.blocks() ?? [];
  const after = from ?? blocks[blocks.length - 1]?.id;
  return {
    edit: 'insertBlock',
    block: {
      id,
      type: RECORDING_TYPE,
      data: { recording: entry.id },
      fallback: fallbackFor(),
      ...(frame ? { frame } : {}),
    },
    ...(after ? { after } : {}),
  };
}

/**
 * Sends the insert with the entry. The block with the caret may be a new text box the core hasn't heard of yet:
 * then the recording goes at the end.
 */
async function sendInsert(
  queue: SyncQueue,
  id: BlockId,
  entry: RecordingEntry,
  options: InsertOptions = {},
): Promise<{ edit: InsertEdit; ack: TxnAck }> {
  const edit = insertEdit(id, entry, options.after);
  const entryEditsOf = await entryEdits(pageId() ?? '', entry, { track: options.track ?? 'growing' });
  try {
    return { edit, ack: await queue.send({ edits: [edit, ...entryEditsOf] }) };
  } catch (error) {
    if ((error as { code?: string }).code !== 'notFound' || edit.after === undefined) throw error;
    const { after: _unknown, ...atEnd } = edit;
    return { edit: atEnd, ack: await queue.send({ edits: [atEnd, ...entryEditsOf] }) };
  }
}

function showBlock(id: BlockId, edit: InsertEdit, ack: TxnAck): void {
  const now = new Date().toISOString();
  const { block } = edit;
  shownLayer.get()?.upsert({
    id,
    type: RECORDING_TYPE,
    order: ack.orderKeys[id] ?? 'zz',
    created: now,
    modified: now,
    data: block.data,
    ...(block.frame ? { frame: block.frame } : {}),
    ...(block.fallback ? { fallback: block.fallback } : {}),
  });
}

/** Where a new recording block goes, and whether its files are still being written (the default). */
export interface InsertOptions {
  after?: BlockId;
  track?: 'growing' | 'finished';
}

/** Adds the recording's block after the block with the caret, or at the end. It doesn't move the caret. */
export async function insertRecordingBlock(entry: RecordingEntry, options?: InsertOptions): Promise<BlockId> {
  const queue = shownQueue.get();
  if (!queue || !shownLayer.get()) throw new Error('No page is shown.');
  const id: BlockId = newId();
  const { edit, ack } = await sendInsert(queue, id, entry, options);
  setEntries([entry]);
  showBlock(id, edit, ack);
  return id;
}

/**
 * Saves a recording's entry in `page`. A block the person deleted or undid while recording is put back. When the
 * page isn't the one shown, such as after the person went to another page, it is opened just for the change.
 */
export async function writeEntry(
  page: string,
  block: BlockId,
  entry: RecordingEntry,
  change?: TrackChange,
): Promise<void> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  setEntries([entry]);
  if (queue && layer && pageId() === page) {
    if (layer.block(block)) {
      await queue.send({ edits: await entryEdits(page, entry, change) });
      return;
    }
    const { edit, ack } = await sendInsert(queue, block, entry);
    showBlock(block, edit, ack);
    return;
  }
  const open = await pagesClient().open(page, { viewport: null });
  try {
    await open.send({ edits: await entryEdits(page, entry, change) });
    await open.saveNow();
  } finally {
    await open.close();
  }
}

/** Removes a block and its entry, as when a recording never began. */
export async function removeBlock(block: BlockId, recording: string): Promise<void> {
  const queue = shownQueue.get();
  const layer = shownLayer.get();
  if (!queue || !layer) return;
  const forget: Edit = { edit: 'setPage', view: { recordings: { [recording]: null } } };
  const held = commandContext('commandBar').platform.audio.keepsAssets ? entryOf(recording) : null;
  const assets: Edit[] = (held?.tracks ?? []).map((track) => ({ edit: 'removeAsset', asset: track.asset }));
  await queue.send({ edits: [{ edit: 'deleteBlocks', blocks: [block] }, forget, ...assets] });
  layer.remove(block);
  removeEntry(recording);
}

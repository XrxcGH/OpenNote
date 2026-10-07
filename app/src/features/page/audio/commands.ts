// What the audio commands do (Phase 9), in a module that loads when one runs. registrations/audio.ts declares the
// commands at start-up; this is their work.
import type { BlockJson } from '../../../services/pages/types';
import { announce } from '../../../ui';
import { t } from '../../../strings/t';
import { dataOf, pageId, recordingBlocks } from './blocks';
import { flagNow, startRecording, stopRecording, togglePause } from './controller';
import { trimSilence } from './edits';
import { addFlag } from './flagEdits';
import { captureNow, jumpToFlag, openFor, playbackUi, skipBack, skipForward, toggle } from './playback';

export { startRecording as record, stopRecording as stop, togglePause as pause };

/** The recording the playback commands act on: the open one, else the first one of the page that has stopped. */
function target(): BlockJson | null {
  const blocks = recordingBlocks();
  const open = playbackUi.get().block;
  return (
    blocks.find((block) => block.id === open) ??
    blocks.find((block) => dataOf(block)?.entry.state !== 'recording') ??
    null
  );
}

async function opened(): Promise<BlockJson | null> {
  const block = target();
  const page = pageId();
  if (!block || !page) return null;
  return (await openFor(block, page)) ? block : null;
}

export async function play(): Promise<void> {
  if (await opened()) await toggle();
}

export async function skip(direction: 'back' | 'forward'): Promise<void> {
  if (await opened()) await (direction === 'back' ? skipBack() : skipForward());
}

export async function flag(): Promise<void> {
  const page = pageId();
  if (playbackUi.get().block === null && !(await opened())) return void (await flagNow());
  const block = target();
  const data = block && dataOf(block);
  const captureNs = captureNow();
  if (!block || !data || !page || captureNs === null) return;
  await addFlag(page, block.id, data.entry, captureNs, playbackUi.get().status?.positionNs ?? 0);
}

export async function goToFlag(direction: 'next' | 'previous'): Promise<void> {
  if (!(await opened())) return;
  if (!(await jumpToFlag(direction))) announce(t('audio.announce.noFlag'));
}

export async function playFromCaret(): Promise<void> {
  const { playFromCaret: play } = await import('./stamps');
  if (!(await play())) announce(t('audio.announce.nothingStamped'));
}

export async function playFromInk(): Promise<void> {
  const { playFromInk: play } = await import('./stamps');
  if (!(await play())) announce(t('audio.announce.nothingStamped'));
}

export async function trim(): Promise<void> {
  const block = target();
  const data = block && dataOf(block);
  const page = pageId();
  if (block && data && page) await trimSilence(block.id, page, data.entry);
}

/** A split must leave at least this much on each side, as the More menu does. */
const SPLIT_MARGIN_NS = 1_000_000_000;

/** The recording the palette commands edit, opened for listening, with where the listening position is. */
async function edited(): Promise<{
  block: BlockJson;
  entry: NonNullable<ReturnType<typeof dataOf>>['entry'];
  page: string;
  position: number;
  total: number;
} | null> {
  const block = await opened();
  const data = block && dataOf(block);
  const page = pageId();
  const status = playbackUi.get().status;
  if (!block || !data || !page || data.entry.state === 'recording') return null;
  return { block, entry: data.entry, page, position: status?.positionNs ?? 0, total: status?.durationNs ?? 0 };
}

/** Splits the recording at the listening position (Split recording in the palette). */
export async function split(): Promise<void> {
  const open = await edited();
  if (!open) return void announce(t('accounts.audio.noRecording'));
  if (open.position < SPLIT_MARGIN_NS || open.position > open.total - SPLIT_MARGIN_NS) {
    return void announce(t('audioMore.split.tooEarly'));
  }
  const { splitRecording } = await import('./edits');
  await splitRecording(open.block.id, open.page, open.entry, open.position);
}

/** Makes the enhanced copy, or removes it when there is one (Enhance voice in the palette). */
export async function enhance(): Promise<void> {
  const open = await edited();
  if (!open) return void announce(t('accounts.audio.noRecording'));
  const module = await import('./enhance');
  const { enhancedTracks } = await import('../../../core/audio');
  if (enhancedTracks(open.entry).length > 0) await module.removeEnhanced(open.block, open.page, open.entry);
  else await module.enhanceVoice(open.block, open.page, open.entry);
}

/** Saves the recording as one WAV or Opus file (Export as WAV and Export as Opus in the palette). */
export async function exportAs(format: 'wav' | 'opus'): Promise<void> {
  const open = await edited();
  if (!open) return void announce(t('accounts.audio.noRecording'));
  const { exportRecording } = await import('./exportAudio');
  await exportRecording(open.page, open.entry, format);
}

/**
 * Removes a part. The first run marks where the part starts at the listening position; after moving, the second
 * run removes up to the new position, after asking, as the More menu does.
 */
export async function removeSelected(): Promise<void> {
  const open = await edited();
  if (!open) return void announce(t('accounts.audio.noRecording'));
  const { markPartStart, partStart, removePart } = await import('./edits');
  const start = partStart(open.entry.id);
  if (start === undefined || open.position <= start) return markPartStart(open.entry.id, open.position);
  await removePart(open.block.id, open.page, open.entry, open.position);
}

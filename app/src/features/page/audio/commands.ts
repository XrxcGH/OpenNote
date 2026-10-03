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

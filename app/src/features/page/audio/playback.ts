// Playback, from the interface's side (Phase 9). One recording plays at a time. Opening one asks the host for its
// length and position map; after that, where a stroke or word falls in the audio, and what to highlight at a
// moment, are worked out here with no calls to the host (core/audio/playback.ts).
import { PlaybackSession, StampIndex } from '../../../core/audio';
import type { PlaybackStatus, RecordingEntry, StampEntry, Target } from '../../../core/audio';
import { Flags } from '../../../core/audio';
import type { BlockJson } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import { dataOf } from './blocks';
import { describeError, platformAudio } from './controller';
import { playbackOpen } from './state';

export interface PlaybackUi {
  /** The block whose recording is open. */
  block: string | null;
  recording: string | null;
  status: PlaybackStatus | null;
  /** The strokes, words, and flags written at the moment that plays. */
  highlight: readonly StampEntry[];
  error: string | null;
}

const NONE: PlaybackUi = { block: null, recording: null, status: null, highlight: [], error: null };
export const playbackUi = createStore<PlaybackUi>(NONE, 'audio playback');

let session: PlaybackSession | null = null;
let opening: Promise<boolean> | null = null;
const sources = new Set<() => StampEntry[]>();

/**
 * Adds a source of stamps for what was written while a recording ran: the text marks, and the ink layer's strokes
 * through `strokeEntries(recordings, strokes)`. Returns a function that removes it.
 */
export function addStampSource(source: () => StampEntry[]): () => void {
  sources.add(source);
  return () => void sources.delete(source);
}

const LISTENED_KEY = 'opennote.audio.listened';

function listened(recording: string): number {
  try {
    const all = JSON.parse(localStorage.getItem(LISTENED_KEY) ?? '{}') as Record<string, number>;
    return typeof all[recording] === 'number' ? all[recording] : 0;
  } catch {
    return 0;
  }
}

function rememberListened(recording: string, positionNs: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(LISTENED_KEY) ?? '{}') as Record<string, number>;
    all[recording] = Math.round(positionNs);
    localStorage.setItem(LISTENED_KEY, JSON.stringify(all));
  } catch {
    // Without storage, listening starts from the beginning next time.
  }
}

/** The index of what was written during one recording: its flags, and the page's marks and strokes. */
export function indexFor(entry: RecordingEntry): StampIndex {
  return new StampIndex([...Flags.fromEntries([entry]).stampEntries(), ...[...sources].flatMap((source) => source())]);
}

/** Opens a block's recording, paused. Resolves false when it can't be opened, with the reason in the store. */
export function openFor(block: BlockJson, pageId: string): Promise<boolean> {
  const data = dataOf(block);
  if (!data) return Promise.resolve(false);
  if (playbackUi.get().block === block.id && session && playbackUi.get().error === null) return Promise.resolve(true);
  opening = (async () => {
    await closePlayback();
    const audio = platformAudio();
    const next = new PlaybackSession(audio.host);
    try {
      const assetsDir = await audio.assetsDir(pageId);
      await next.open(assetsDir, data.entry, null, listened(data.entry.id));
      next.setIndex(indexFor(data.entry));
      session = next;
      playbackOpen.set(true);
      playbackUi.set({ block: block.id, recording: data.entry.id, status: null, highlight: [], error: null });
      next.watch((view) => {
        if (session !== next) return;
        if (view.status.state !== 'playing') rememberListened(data.entry.id, view.status.positionNs);
        playbackUi.set((state) => ({ ...state, status: view.status, highlight: view.highlight }));
      });
      return true;
    } catch (error) {
      session = null;
      playbackUi.set({ ...NONE, block: block.id, recording: data.entry.id, error: describeError(error) });
      return false;
    } finally {
      opening = null;
    }
  })();
  return opening;
}

export async function closePlayback(): Promise<void> {
  const closing = session;
  session = null;
  playbackOpen.set(false);
  playbackUi.set(NONE);
  await closing?.close().catch(() => undefined);
}

/** Refreshes the index after the page's marks or flags changed. */
export function refreshIndex(entry: RecordingEntry): void {
  session?.setIndex(indexFor(entry));
}

async function withSession<T>(work: (open: PlaybackSession) => Promise<T>): Promise<T | undefined> {
  if (!session) return undefined;
  try {
    return await work(session);
  } catch (error) {
    playbackUi.set((state) => ({ ...state, error: describeError(error) }));
    return undefined;
  }
}

export const toggle = () => withSession((open) => open.toggle());
export const seek = (positionNs: number) => withSession((open) => open.seek(positionNs));
export const skipBack = () => withSession((open) => open.skipBack());
export const skipForward = () => withSession((open) => open.skipForward());
export const setSpeed = (speed: number) => withSession((open) => open.setSpeed(speed));
export const setSkipSilence = (on: boolean) => withSession((open) => open.setSkipSilence(on));
export const jumpToFlag = (direction: 'next' | 'previous') => withSession((open) => open.jumpToFlag(direction));

/** Tap a stroke or word: seeks to the moment it was written and plays. */
export async function playFrom(target: Target): Promise<boolean> {
  const played = await withSession((open) => open.playFrom(target));
  return played === true;
}

/** Plays from a position in the open recording, even if it was playing already. */
export async function playAt(positionNs: number): Promise<void> {
  await seek(positionNs);
  if (playbackUi.get().status?.state !== 'playing') await toggle();
}

/** The capture time of the moment that plays now, which a flag dropped now is stamped with. */
export function captureNow(): number | null {
  const position = playbackUi.get().status?.positionNs;
  return session && position !== undefined ? session.positions.captureAt(position) : null;
}

/** Plays from the moment of a capture time, such as the one a word was typed at. */
export async function playAtCapture(captureNs: number): Promise<void> {
  const located = session?.positions.locate(captureNs);
  if (located) await playAt(located.positionNs);
}

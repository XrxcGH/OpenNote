// Where the playing video is, for notes typed while it plays. A player block that can report its position (YouTube and
// Vimeo) says it here, and a note typed meanwhile is stamped with it exactly as a note typed during a recording is
// (features/page/audio/stamps.ts): the stamp names the player block as the "recording" and holds the position in
// nanoseconds. Alt+click or a tap on such a note then seeks that player.
import { createStore } from '../../../state/store';

/** The "recording" ID that a stamp from a player carries. */
export const PLAYER_PREFIX = 'player:';

export interface Playhead {
  block: string;
  page: string;
  ms: number;
  playing: boolean;
}

export const playhead = createStore<Playhead | null>(null, 'media playhead');

const seekers = new Map<string, (ms: number) => void>();

/** Lets a player block be seeked. Answers the function that takes it away. */
export function registerSeeker(block: string, seek: (ms: number) => void): () => void {
  seekers.set(block, seek);
  return () => {
    if (seekers.get(block) === seek) seekers.delete(block);
  };
}

/** The stamp for text typed now: the position of the player that is playing, or null. */
export function playerStamp(page: string | null): { recording: string; captureNs: number } | null {
  const head = playhead.get();
  if (!head || !head.playing || head.page !== page) return null;
  return { recording: `${PLAYER_PREFIX}${head.block}`, captureNs: Math.round(head.ms * 1e6) };
}

export const isPlayerStamp = (recording: string): boolean => recording.startsWith(PLAYER_PREFIX);

/** Seeks the player a stamp names. False when that player is not on the page. */
export function seekPlayerStamp(recording: string, captureNs: number): boolean {
  const seek = seekers.get(recording.slice(PLAYER_PREFIX.length));
  if (!seek) return false;
  seek(Math.max(0, captureNs / 1e6));
  return true;
}

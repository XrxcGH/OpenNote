// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { entry, fakeHost, manualScheduler, playingAt } from './fake';
import type { AudioHost } from './host';
import { PlaybackSession } from './playback';
import { isFlag, StampIndex } from './stamps';
import type { StampEntry } from './types';

const written = (id: string, startS: number, endS: number): StampEntry => ({
  recording: 'r1',
  startNs: (100 + startS) * 1_000_000_000,
  endNs: (100 + endS) * 1_000_000_000,
  target: { type: 'stroke', id },
});

const flag = (id: string, atS: number): StampEntry => ({
  recording: 'r1',
  startNs: (100 + atS) * 1_000_000_000,
  endNs: (100 + atS) * 1_000_000_000,
  target: { type: 'flag', id },
});

/** A session on a recording that spans 100 to 107 s of the capture clock, with strokes and flags written in it. */
async function opened(overrides: Partial<AudioHost> = {}) {
  const { host, calls } = fakeHost(overrides);
  const timer = manualScheduler();
  const session = new PlaybackSession(host, timer.scheduler);
  await session.open('assets', entry());
  session.setIndex(new StampIndex([written('a', 1, 2), written('b', 4, 5), flag('f1', 3), flag('f2', 6)]));
  calls.length = 0;
  return { session, calls, timer };
}

describe('PlaybackSession taps and highlights', () => {
  it('seeks to the moment a stroke was written and plays', async () => {
    const { session, calls } = await opened();
    expect(await session.playFrom({ type: 'stroke', id: 'b' })).toBe(true);
    expect(calls).toEqual(['seek 4000000000', 'play']);
    expect(await session.playFrom({ type: 'stroke', id: 'nope' })).toBe(false);
  });

  it('highlights what was written at the moment that plays', async () => {
    let positionNs = 1_500_000_000;
    const { session, timer } = await opened({ playbackStatus: async () => playingAt(positionNs) });
    const seen: string[][] = [];
    session.watch((view) => seen.push(view.highlight.map((e) => (e.target as { id: string }).id)));
    await timer.tick();
    positionNs = 2_800_000_000;
    await timer.tick();
    positionNs = 4_100_000_000;
    await timer.tick();
    expect(seen).toEqual([['a'], [], ['b']]);
    expect(session.listenedNs).toBe(4_100_000_000);
  });

  it('jumps between flags with the keys', async () => {
    let positionNs = 1_000_000_000;
    const { session, calls } = await opened({ playbackStatus: async () => playingAt(positionNs) });
    expect(await session.jumpToFlag('next')).toBe(true);
    positionNs = 3_000_000_000;
    expect(await session.jumpToFlag('next')).toBe(true);
    positionNs = 6_000_000_000;
    expect(await session.jumpToFlag('next')).toBe(false);
    expect(await session.jumpToFlag('previous')).toBe(true);
    expect(calls.filter((call) => call.startsWith('seek'))).toEqual([
      'seek 3000000000',
      'seek 6000000000',
      'seek 3000000000',
    ]);
    expect(isFlag({ type: 'flag', id: 'x' })).toBe(true);
  });
});

describe('PlaybackSession controls', () => {
  it('skips by ten seconds, clamps the speed, and toggles', async () => {
    const { session, calls } = await opened();
    await session.skipBack();
    await session.skipForward();
    await session.setSpeed(9);
    await session.setSpeed(0.1);
    await session.toggle();
    expect(calls).toEqual(['skip -10000000000', 'skip 10000000000', 'speed 3', 'speed 0.5', 'playbackStatus', 'play']);
  });

  it('opens at the place where listening stopped, and closes the player', async () => {
    const { host, calls } = fakeHost();
    const session = new PlaybackSession(host, manualScheduler().scheduler);
    await session.open('assets', entry(), null, 2_000_000_000);
    expect(calls).toEqual(['openPlayback', 'seek 2000000000']);
    await session.close();
    expect(calls.at(-1)).toBe('closePlayback');
  });
});

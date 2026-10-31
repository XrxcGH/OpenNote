import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { beatSeconds, play, schedulePass, startTimes, tapTempo } from './audio';
import type { AudioLike, PlayPlan } from './audio';

/** A stand-in audio clock that records every oscillator's start, stop, pitch, and wave. */
function fakeAudio() {
  const starts: number[] = [];
  const freqs: number[] = [];
  const types: string[] = [];
  const peaks: number[] = [];
  const audio = {
    currentTime: 0,
    closed: false,
    destination: {},
    createOscillator: () => ({
      set type(value: string) {
        types.push(value);
      },
      frequency: {
        set value(hz: number) {
          freqs.push(hz);
        },
      },
      connect() {},
      start(at: number) {
        starts.push(at);
      },
      stop() {},
    }),
    createGain: () => ({
      gain: {
        value: 1,
        setValueAtTime() {},
        linearRampToValueAtTime(value: number) {
          peaks.push(value);
        },
        exponentialRampToValueAtTime() {},
      },
      connect() {},
    }),
    close() {
      audio.closed = true;
      return Promise.resolve();
    },
  };
  return { audio: audio as AudioLike & typeof audio, starts, freqs, types, peaks };
}

const plan = (over: Partial<PlayPlan> = {}): PlayPlan => ({
  notes: [
    { at: 0, dur: 1, hz: 1000, level: 2, voice: 'click' },
    { at: 1, dur: 1, hz: 800, level: 1, voice: 'click' },
    { at: 2.5, dur: 0.5, hz: 440, level: 0, voice: 'tone' },
  ],
  beats: 4,
  bpm: 120,
  loop: false,
  ...over,
});

describe('the beat clock', () => {
  it('turns beats into seconds at a tempo', () => {
    expect(beatSeconds(120)).toBe(0.5);
    expect(beatSeconds(60)).toBe(1);
    expect(startTimes(plan(), 10)).toEqual([10, 10.5, 11.25]);
  });
  it('schedules every note of one pass and returns where the pass ends', () => {
    const { audio, starts, freqs, types, peaks } = fakeAudio();
    const end = schedulePass(plan(), audio, 2);
    expect(starts).toEqual([2, 2.5, 3.25]);
    expect(end).toBe(4);
    expect(freqs).toEqual([1000, 800, 440]);
    expect(types).toEqual(['square', 'square', 'triangle']);
    expect(peaks[0]!).toBeGreaterThan(peaks[1]!);
    expect(peaks[1]!).toBeGreaterThan(peaks[2]!);
  });
});

describe('the player', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays a plan that does not loop once and then reports the end', () => {
    const { audio, starts } = fakeAudio();
    const onEnd = vi.fn();
    play(() => plan(), audio, onEnd);
    expect(starts).toHaveLength(3);
    expect(onEnd).not.toHaveBeenCalled();
    audio.currentTime = 3;
    vi.advanceTimersByTime(200);
    expect(onEnd).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(starts).toHaveLength(3);
  });
  it('keeps a looping plan scheduled a little ahead of the clock, bar after bar', () => {
    const { audio, starts } = fakeAudio();
    play(() => plan({ loop: true, notes: [{ at: 0, dur: 1, hz: 1000, level: 2, voice: 'click' }], beats: 2 }), audio);
    for (let t = 0; t < 5; t += 0.5) {
      audio.currentTime = t;
      vi.advanceTimersByTime(500);
    }
    // One click per bar of one second, starting just after zero, with no gap and no repeat.
    const spacing = starts.slice(1).map((s, i) => Math.round((s - starts[i]!) * 1000) / 1000);
    expect(spacing.every((gap) => gap === 1)).toBe(true);
    expect(starts.length).toBeGreaterThanOrEqual(5);
  });
  it('uses a new tempo from the next bar after the plan changes', () => {
    const { audio, starts } = fakeAudio();
    let bpm = 60;
    play(
      () => plan({ loop: true, bpm, notes: [{ at: 0, dur: 1, hz: 1000, level: 2, voice: 'click' }], beats: 1 }),
      audio,
    );
    audio.currentTime = 1;
    vi.advanceTimersByTime(130);
    bpm = 120;
    audio.currentTime = 4;
    vi.advanceTimersByTime(130);
    const gaps = starts.slice(1).map((s, i) => Math.round((s - starts[i]!) * 1000) / 1000);
    expect(gaps).toContain(1);
    expect(gaps).toContain(0.5);
  });
  it('stops scheduling and closes the audio on stop', () => {
    const { audio, starts } = fakeAudio();
    const player = play(() => plan({ loop: true }), audio);
    player.stop();
    const count = starts.length;
    audio.currentTime = 20;
    vi.advanceTimersByTime(2000);
    expect(starts).toHaveLength(count);
    expect(audio.closed).toBe(true);
  });
});

describe('tap tempo', () => {
  it('reads a steady tap as the tempo', () => {
    expect(tapTempo([0, 500, 1000, 1500])).toBe(120);
    expect(tapTempo([100, 1100])).toBe(60);
  });
  it('uses the middle gap so one slip does not move the tempo', () => {
    expect(tapTempo([0, 500, 1000, 1900, 2400])).toBe(120);
  });
  it('needs two taps and a believable tempo', () => {
    expect(tapTempo([])).toBeNull();
    expect(tapTempo([5])).toBeNull();
    expect(tapTempo([0, 5000])).toBeNull();
    expect(tapTempo([0, 50])).toBeNull();
    expect(tapTempo([0, 0])).toBeNull();
  });
});

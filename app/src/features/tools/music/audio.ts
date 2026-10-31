// A small Web Audio player for clicks and tones: no samples are downloaded, every sound is an oscillator with a short
// envelope. A plan lists notes in beats; the player turns beats into the audio clock's seconds and schedules a little
// ahead, so timing does not depend on the page's own timers. Nothing is recorded and nothing leaves the device.

export interface PlayNote {
  /** Start, in beats from the start of the plan. */
  at: number;
  /** Length in beats. */
  dur: number;
  hz: number;
  /** 0 is soft, 1 is normal, and 2 is an accent. */
  level: 0 | 1 | 2;
  voice: 'click' | 'tone';
}

export interface PlayPlan {
  notes: PlayNote[];
  /** Beats in one pass. */
  beats: number;
  bpm: number;
  loop: boolean;
  /** The form field that holds the tempo, so Tap can set it. */
  tempoField?: string;
}

/** The parts of an AudioContext the player uses, so a test can stand in for it. */
export interface AudioLike {
  currentTime: number;
  destination: unknown;
  createOscillator(): {
    type: string;
    frequency: { value: number };
    connect(node: unknown): void;
    start(at: number): void;
    stop(at: number): void;
  };
  createGain(): {
    gain: {
      value: number;
      setValueAtTime(value: number, at: number): void;
      linearRampToValueAtTime(value: number, at: number): void;
      exponentialRampToValueAtTime(value: number, at: number): void;
    };
    connect(node: unknown): void;
  };
  close?(): Promise<void>;
  resume?(): Promise<void>;
}

const LEVEL_GAIN = [0.18, 0.4, 0.8] as const;

/** Seconds per beat at a tempo. */
export const beatSeconds = (bpm: number): number => 60 / bpm;

/** The audio-clock start time of each note in one pass of a plan that begins at `start` seconds. */
export const startTimes = (plan: PlayPlan, start: number): number[] =>
  plan.notes.map((note) => start + note.at * beatSeconds(plan.bpm));

/** Schedules one pass of a plan on an audio context; returns the time when the pass ends. */
export function schedulePass(plan: PlayPlan, audio: AudioLike, start: number): number {
  const spb = beatSeconds(plan.bpm);
  for (const note of plan.notes) {
    const at = start + note.at * spb;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    const peak = LEVEL_GAIN[note.level];
    const length = note.voice === 'click' ? 0.04 : Math.max(0.08, note.dur * spb * 0.95);
    osc.type = note.voice === 'click' ? 'square' : 'triangle';
    osc.frequency.value = note.hz;
    gain.gain.value = 0;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(at);
    osc.stop(at + length + 0.02);
  }
  return start + plan.beats * spb;
}

export interface Player {
  stop(): void;
}

const LOOKAHEAD = 0.6;
const POLL_MS = 120;

/**
 * Plays a plan, looping if it says so. `getPlan` is read at the start of every pass, so a tempo change takes
 * effect at the next bar. `onEnd` runs when a plan that does not loop has finished.
 */
export function play(getPlan: () => PlayPlan, audio: AudioLike, onEnd: () => void = () => undefined): Player {
  let next = audio.currentTime + 0.08;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let ended = false;
  const pump = () => {
    if (stopped) return;
    while (!ended && next < audio.currentTime + LOOKAHEAD) {
      const plan = getPlan();
      next = schedulePass(plan, audio, next);
      if (!plan.loop) ended = true;
    }
    if (ended && next <= audio.currentTime) {
      stopped = true;
      onEnd();
      return;
    }
    timer = setTimeout(pump, POLL_MS);
  };
  pump();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      void audio.close?.();
    },
  };
}

/** A new audio context in the browser, or null where there is none. */
export function newAudioContext(): AudioLike | null {
  const Ctor = (globalThis as { AudioContext?: new () => AudioLike }).AudioContext;
  return Ctor ? new Ctor() : null;
}

/** A tempo from the gaps between taps in milliseconds: the median gap, kept between 20, and 400 BPM. */
export function tapTempo(taps: readonly number[]): number | null {
  if (taps.length < 2) return null;
  const gaps = taps
    .slice(1)
    .map((t, i) => t - taps[i]!)
    .sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)]!;
  if (median <= 0) return null;
  const bpm = 60000 / median;
  return bpm < 20 || bpm > 400 ? null : Math.round(bpm * 10) / 10;
}

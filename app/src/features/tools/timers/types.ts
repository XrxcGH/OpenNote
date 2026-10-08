// Timer data. Everything here is plain JSON, so it can be saved, restored, and sent between windows.
// Times are milliseconds. "Clock readings" are epoch milliseconds from an injected clock (see clock.ts).

export type TimerKind = 'countdown' | 'stopwatch' | 'focus';

export interface CountdownConfig {
  kind: 'countdown';
  durationMs: number;
}

export interface StopwatchConfig {
  kind: 'stopwatch';
}

/** Work and break periods that alternate, starting with work. The last work period has no break after it. */
export interface FocusConfig {
  kind: 'focus';
  workMs: number;
  breakMs: number;
  /** The number of work periods. */
  cycles: number;
}

export type TimerConfig = CountdownConfig | StopwatchConfig | FocusConfig;

export type TimerStatus = 'idle' | 'running' | 'paused' | 'done';

export type TimerAction = 'start' | 'pause' | 'resume' | 'reset' | 'lap';

export interface TimerState {
  id: string;
  label: string;
  config: TimerConfig;
  status: TimerStatus;
  /** Active time before the current run. */
  elapsedMs: number;
  /** The clock reading when the current run began, or null when the timer isn't running. */
  runningSince: number | null;
  /** The clock reading when the timer reached its end, or null. */
  finishedAt: number | null;
  /** Stopwatch only: the elapsed time at each lap. */
  laps: number[];
  /** The person asked for a Windows notification when this timer ends. Off when missing. */
  notify?: boolean;
}

export interface TimerSet {
  timers: TimerState[];
  /** Makes ids such as "t3", so a saved set never reuses one. */
  nextId: number;
}

export type FocusPhase = 'work' | 'break';

export interface FocusView {
  phase: FocusPhase;
  /** 0 for the first work period, 1 for the first break, and so on. */
  phaseIndex: number;
  /** The 1-based work period this phase belongs to. */
  cycle: number;
  cycles: number;
  phaseLeftMs: number;
  /** When this phase ends, or null if the timer isn't running. */
  phaseEndsAt: number | null;
}

/** What a timer shows at one moment. Derived from a TimerState and a clock reading, never saved. */
export interface TimerView {
  id: string;
  label: string;
  kind: TimerKind;
  status: TimerStatus;
  elapsedMs: number;
  /** Time until the timer ends, or null for a stopwatch. */
  leftMs: number | null;
  /** When the timer ends, or null if it isn't running or never ends. */
  endsAt: number | null;
  finishedAt: number | null;
  /** When to check this timer again, or null if nothing will change on its own. */
  nextChangeAt: number | null;
  focus: FocusView | null;
  laps: number[];
  /** Whether the person asked for a notification when this timer ends. */
  notify: boolean;
}

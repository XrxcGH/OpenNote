// The queue behind the activity panel (Phase 12): work that happens for the person but not at their request, such as
// reading the text in a new image. It runs one job at a time, and only when the person's limits allow: not while
// paused, not while the computer is busy or unplugged if they said so, and with rests between jobs that keep the
// average share of the processor under the cap. The scheduler is plain code with its surroundings handed in, so a
// test can drive it with a clock of its own.
import { createStore } from '../../../state/store';
import type { Store } from '../../../state/store';

export type JobKind = 'imageText' | 'handwriting' | 'transcription' | 'indexing';
export type JobStatus = 'waiting' | 'running' | 'failed' | 'done';
/** What keeps the next job from starting, when something does. */
export type WaitReason = 'paused' | 'idle' | 'power' | 'request';

export interface JobSpec {
  /** The same ID twice is the same job: the second is ignored while the first is waiting, running, or done. */
  id: string;
  kind: JobKind;
  /** What the person sees, such as "Photo of a whiteboard". */
  label: string;
  /** Started by the app, not by the person. Such a job is left out when the person chose to run work only on request. */
  automatic?: boolean;
  run(signal: AbortSignal): Promise<void>;
}

export interface JobInfo {
  id: string;
  kind: JobKind;
  label: string;
  status: JobStatus;
}

export interface BackgroundPrefs {
  paused: boolean;
  /** Start work only when the person hasn't used the computer for a while. */
  onlyWhenIdle: boolean;
  onlyWhenPluggedIn: boolean;
  /** Automatic jobs are not queued at all. */
  onlyOnRequest: boolean;
  /** The share of the processor the work may use on average, as a percentage. */
  cpuPercent: number;
}

export const DEFAULT_PREFS: BackgroundPrefs = {
  paused: false,
  onlyWhenIdle: false,
  onlyWhenPluggedIn: false,
  onlyOnRequest: false,
  cpuPercent: 50,
};

export const CPU_CHOICES = [25, 50, 75, 100] as const;

export interface BackgroundState {
  jobs: readonly JobInfo[];
  prefs: BackgroundPrefs;
  /** Why work is waiting, or null when it can go. */
  waiting: WaitReason | null;
}

export interface Surroundings {
  /** The person hasn't used the computer for a while. */
  idle(): boolean;
  pluggedIn(): boolean;
  now(): number;
}

/** How long after the last key or touch the computer counts as idle. */
export const IDLE_AFTER_MS = 30_000;
/** How often a waiting queue looks again, since idle and power change without telling anyone. */
export const RECHECK_MS = 5_000;

/** The rest after a job that took `workMs`, so the work's share of the time stays at `percent`. */
export function restAfter(workMs: number, percent: number): number {
  const share = Math.min(100, Math.max(5, percent));
  return Math.round(workMs * (100 / share - 1));
}

interface Entry {
  spec: JobSpec;
  info: JobInfo;
  controller: AbortController | null;
}

export interface Scheduler {
  state: Store<BackgroundState>;
  /** Adds a job. Returns false when it was left out, such as a repeat or an automatic job in on-request mode. */
  enqueue(spec: JobSpec): boolean;
  cancel(id: string): void;
  retry(id: string): void;
  clearFinished(): void;
  setPrefs(patch: Partial<BackgroundPrefs>): void;
  /** Looks again at whether the next job may start. Called when something it depends on changes. */
  pump(): void;
  /** Stops the timer. */
  dispose(): void;
}

export function createScheduler(surroundings: Surroundings, initial: Partial<BackgroundPrefs> = {}): Scheduler {
  const entries: Entry[] = [];
  const state = createStore<BackgroundState>(
    { jobs: [], prefs: { ...DEFAULT_PREFS, ...initial }, waiting: null },
    'intel background work',
  );
  let timer: ReturnType<typeof setTimeout> | null = null;
  let restUntil = 0;
  let running: Entry | null = null;

  const publish = (waiting: WaitReason | null) =>
    state.set((current) => ({ ...current, jobs: entries.map((entry) => ({ ...entry.info })), waiting }));

  const blocker = (): WaitReason | null => {
    const { prefs } = state.get();
    if (prefs.paused) return 'paused';
    if (prefs.onlyWhenIdle && !surroundings.idle()) return 'idle';
    if (prefs.onlyWhenPluggedIn && !surroundings.pluggedIn()) return 'power';
    return null;
  };

  const later = (ms: number) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, ms);
  };

  function pump(): void {
    if (running) return publish(null);
    const next = entries.find((entry) => entry.info.status === 'waiting');
    const reason = blocker();
    publish(next ? reason : null);
    if (!next) return;
    if (reason) return later(RECHECK_MS);
    const rest = restUntil - surroundings.now();
    if (rest > 0) return later(rest);
    void start(next);
  }

  async function start(entry: Entry): Promise<void> {
    running = entry;
    const controller = new AbortController();
    entry.controller = controller;
    entry.info.status = 'running';
    publish(null);
    const began = surroundings.now();
    try {
      await entry.spec.run(controller.signal);
      entry.info.status = 'done';
    } catch {
      // A job that was canceled is gone from the list already, and one that failed stays so it can be retried.
      if (entries.includes(entry)) entry.info.status = controller.signal.aborted ? 'waiting' : 'failed';
    }
    entry.controller = null;
    running = null;
    restUntil = surroundings.now() + restAfter(surroundings.now() - began, state.get().prefs.cpuPercent);
    pump();
  }

  return {
    state,
    enqueue(spec) {
      if (entries.some((entry) => entry.spec.id === spec.id)) return false;
      if (spec.automatic && state.get().prefs.onlyOnRequest) return false;
      entries.push({
        spec,
        info: { id: spec.id, kind: spec.kind, label: spec.label, status: 'waiting' },
        controller: null,
      });
      pump();
      return true;
    },
    cancel(id) {
      const at = entries.findIndex((entry) => entry.spec.id === id);
      if (at < 0) return;
      const [entry] = entries.splice(at, 1);
      entry?.controller?.abort();
      pump();
    },
    retry(id) {
      const entry = entries.find((one) => one.spec.id === id);
      if (entry?.info.status !== 'failed') return;
      entry.info.status = 'waiting';
      pump();
    },
    clearFinished() {
      for (let at = entries.length - 1; at >= 0; at -= 1) {
        const status = entries[at]?.info.status;
        if (status === 'done' || status === 'failed') entries.splice(at, 1);
      }
      pump();
    },
    setPrefs(patch) {
      state.set((current) => ({ ...current, prefs: { ...current.prefs, ...patch } }));
      if (patch.onlyOnRequest) {
        for (let at = entries.length - 1; at >= 0; at -= 1) {
          const entry = entries[at];
          if (entry?.spec.automatic && entry.info.status === 'waiting') entries.splice(at, 1);
        }
      }
      pump();
    },
    pump,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

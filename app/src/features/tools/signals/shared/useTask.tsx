// Runs a signals engine for a tool. A small input runs at once on the main thread, as before; a big one (a long
// recording, a large image) runs in the signals worker with a progress bar and a Cancel button, so the window stays
// responsive. If no worker can start, the engine runs on the main thread instead.
import { useEffect, useMemo, useRef, useState } from 'react';
import { t } from '../../../../strings/t';
import { Button } from '../../../../ui';
import { runTask, type TaskFn } from '../../subjects/num/worker';
import { SignalError, type ErrorKey } from './errors';
import { SIGNAL_TASKS, type SignalTask, type TaskInput, type TaskOutput, type TaskReply } from './tasks';
import { problemText } from './ui';
import styles from './kit.module.css';

export type TaskOutcome<O> = { ok: true; value: O } | { ok: false; problem: string };

const NO_CONTEXT = { progress: () => {}, canceled: () => false };

function outcomeOf<O>(reply: TaskReply<O>): TaskOutcome<O> {
  if (reply.ok) return reply;
  const error = reply.key ? new SignalError(reply.key as ErrorKey, reply.vars) : new Error(reply.message);
  return { ok: false, problem: problemText(error) };
}

const spec = (task: SignalTask, spawn: boolean) => ({
  task,
  ...(spawn
    ? { spawn: () => new Worker(new URL('../worker.ts', import.meta.url), { type: 'module', name: 'signals' }) }
    : {}),
  load: () => Promise.resolve(SIGNAL_TASKS[task] as unknown as TaskFn<unknown, unknown>),
});

export interface TaskState<O> {
  /** The result, or null while the first run of a big input is still going. */
  outcome: TaskOutcome<O> | null;
  /** The share done while a big input runs in the worker, else null. */
  progress: number | null;
  cancel(): void;
}

interface Ran<I, O> {
  /** The job the outcome belongs to. */
  done: I | null;
  outcome: TaskOutcome<O> | null;
  /** The job the progress belongs to, and how far it is. */
  going: I | null;
  progress: number;
}

/**
 * Runs `task` on `job` whenever the job changes (the caller memoizes it). `heavy` sends it to the worker; while it
 * runs the last result stays on screen. A canceled run says so, and the next change runs again.
 */
export function useTask<N extends SignalTask>(
  task: N,
  job: TaskInput<N>,
  heavy: boolean,
  /** False runs nothing and gives a null outcome, for a tool whose current mode does not need the task. */
  enabled = true,
): TaskState<TaskOutput<N>> {
  type O = TaskOutput<N>;
  const here = useMemo(() => {
    if (heavy || !enabled) return null;
    const run = SIGNAL_TASKS[task] as unknown as (input: TaskInput<N>, ctx: typeof NO_CONTEXT) => TaskReply<O>;
    return outcomeOf(run(job, NO_CONTEXT));
  }, [task, job, heavy, enabled]);
  const [ran, setRan] = useState<Ran<TaskInput<N>, O>>({ done: null, outcome: null, going: null, progress: 0 });
  const stop = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!heavy || !enabled) return;
    const control = new AbortController();
    stop.current = control;
    const live = () => !control.signal.aborted;
    const onProgress = (progress: number) => live() && setRan((last) => ({ ...last, going: job, progress }));
    runTask(spec(task, true), job, { onProgress, signal: control.signal })
      .catch((error: unknown) => {
        // A cancel stays canceled; anything else is the worker failing to start, so run the engine here.
        if (!live()) throw error;
        return runTask(spec(task, false), job, { signal: control.signal });
      })
      .then(
        (reply) => live() && setRan((last) => ({ ...last, done: job, outcome: outcomeOf(reply as TaskReply<O>) })),
        () => undefined,
      );
    return () => control.abort();
  }, [task, job, heavy, enabled]);
  const cancel = () => {
    stop.current?.abort();
    setRan((last) => ({ ...last, done: job, outcome: { ok: false, problem: t('kitSignals.ui.canceled') } }));
  };
  if (!enabled) return { outcome: null, progress: null, cancel };
  if (!heavy) return { outcome: here, progress: null, cancel };
  const running = ran.done !== job;
  return { outcome: ran.outcome, progress: running ? (ran.going === job ? ran.progress : 0) : null, cancel };
}

/** The progress bar and Cancel button while a big input runs. */
export function TaskProgress({ progress, cancel }: { progress: number | null; cancel(): void }) {
  if (progress === null) return null;
  const percent = Math.round(100 * progress);
  return (
    <div className={styles.actions} role="group" aria-label={t('kitSignals.ui.working')}>
      <progress max={100} value={percent} aria-label={t('kitSignals.ui.working')} aria-valuetext={`${percent}%`} />
      <Button variant="quiet" onClick={cancel}>
        {t('kitSignals.ui.cancel')}
      </Button>
    </div>
  );
}

/** Work above this many samples or pixels goes to the worker. */
export const HEAVY_SIZE = 200_000;

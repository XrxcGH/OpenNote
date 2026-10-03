// The updater in a browser. It walks through the phases the way the Rust updater does, so the chip, the popover,
// and the Updates section behave as in the app. A check ends with the result a test chose (up to date by
// default), and a download ends ready. Tests move it to any status with the setUpdaterStatus hook. They choose
// the next check's result with setUpdaterCheckResult, and read the calls with updaterCalls.

import type { UpdaterClient, UpdaterPhase, UpdaterStatus } from '../types';
import { emitter } from './emitter';
import { registerTestHook } from './testHooks';

export interface WebUpdater extends UpdaterClient {
  /** Every command, in order, such as 'check' or 'skip 0.5.0'. */
  readonly calls: string[];
  /** Moves the fake to a status and sends it, as updater://status would. */
  setStatus(next: UpdaterStatus): void;
  /** The phase the next check ends in. Default: up to date. */
  setCheckResult(phase: UpdaterPhase): void;
}

/** How long the fake takes for each step, so the interface shows its in-between states. */
const STEP_MS = 150;

const later = (run: () => void) =>
  new Promise<void>((done) =>
    setTimeout(() => {
      run();
      done();
    }, STEP_MS),
  );

export function createWebUpdater(initial: UpdaterStatus): WebUpdater {
  let status = initial;
  let checkResult: UpdaterPhase = { kind: 'upToDate' };
  const changed = emitter<[UpdaterStatus]>();
  const calls: string[] = [];
  const set = (next: Partial<UpdaterStatus>) => {
    status = { ...status, ...next };
    changed.emit(status);
  };
  const setStatus = (next: UpdaterStatus) => set(next);
  const setCheckResult = (phase: UpdaterPhase) => void (checkResult = phase);
  registerTestHook('setUpdaterStatus', setStatus);
  registerTestHook('setUpdaterCheckResult', setCheckResult);
  registerTestHook('updaterCalls', () => calls);

  const check = () => {
    calls.push('check');
    set({ phase: { kind: 'checking' } });
    return later(() => set({ phase: checkResult, lastCheck: new Date().toISOString() }));
  };
  const download = () => {
    calls.push('download');
    const offered = status.phase;
    if (offered.kind !== 'available') return Promise.resolve();
    set({ phase: { kind: 'downloading', version: offered.version, received: 0, total: offered.size } });
    const ready: UpdaterPhase = { kind: 'ready', version: offered.version, notes: offered.notes, blockedBy: null };
    return later(() => set({ phase: ready }));
  };
  const record = (name: string, effect?: () => void) => {
    calls.push(name);
    effect?.();
    return Promise.resolve();
  };
  return {
    calls,
    setStatus,
    setCheckResult,
    status: () => status,
    onStatus: changed.on,
    check,
    download,
    restartToUpdate: () => record('restartToUpdate'),
    skip: (version) => record(`skip ${version}`, () => set({ phase: { kind: 'upToDate' }, skippedVersion: version })),
    unskip: () => record('unskip', () => set({ skippedVersion: null })),
    goBack: () => record('goBack'),
  };
}

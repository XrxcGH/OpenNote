// The studio's runs: one run host for the window (code:L03), with the studio's limits, and the run order built
// from a project and the Code settings. Tests and the behavior specs put a stand-in runner in place.

import type { Settings } from '../../../platform/types';
import type { CodeProject, RunLimits, RunStdin, TestHarness } from '../contracts';
import { DEFAULT_SETTINGS as PROJECT_DEFAULTS } from '../project/model';
import { RunHost } from '../run/host';
import type { RunCallbacks, RunHandle, RunOrder } from '../run/host';
import { RUN_LIMITS } from '../run/protocol';

export interface Runner {
  run(order: RunOrder, callbacks: RunCallbacks): RunHandle;
  warm?(runtime: RunOrder['runtime']): void;
}

const MIB = 1024 * 1024;

/** The most a studio run may take (DESIGN 5.6: tier 1 at most 60 s and 256 MiB). */
export const STUDIO_LIMITS: RunLimits = { ...RUN_LIMITS, timeMs: 60_000, memoryBytes: 256 * MIB };

let runner: Runner | null = null;

export function studioRunner(): Runner {
  runner ??= new RunHost({ limits: STUDIO_LIMITS });
  return runner;
}

/** Puts a stand-in runner in place (tests); null goes back to the real one. */
export function setStudioRunner(next: Runner | null): void {
  runner = next;
}

/**
 * A run's limits: the project's own when it sets them (opennote-project.json), else Settings, then Code. Never
 * more than the studio's limits.
 */
export function limitsFor(project: CodeProject, code: Settings['code']): RunLimits {
  const own = project.settings;
  const timeMs = own.timeMs !== PROJECT_DEFAULTS.timeMs ? own.timeMs : code.timeLimitSeconds * 1000;
  const memoryMb = own.memoryMb !== PROJECT_DEFAULTS.memoryMb ? own.memoryMb : code.memoryLimitMib;
  return {
    ...RUN_LIMITS,
    timeMs: Math.min(timeMs, STUDIO_LIMITS.timeMs),
    memoryBytes: Math.min(memoryMb * MIB, STUDIO_LIMITS.memoryBytes),
  };
}

/** Prefilled input when the project has some, else interactive input from the console's input line. */
export const stdinFor = (project: CodeProject): RunStdin =>
  project.stdin ? { mode: 'prefilled', text: project.stdin } : { mode: 'interactive', text: '' };

/** The run order of a project. Throws nothing; a runtime that is not in the app fails in the worker. */
export function orderFor(project: CodeProject, code: Settings['code'], test?: TestHarness): RunOrder | null {
  if (project.runtime === 'toolchain') return null;
  const main = project.files[project.main];
  if (!main) return null;
  const files = Object.values(project.files).map((file) => ({ path: file.path, text: file.text }));
  return {
    runtime: project.runtime,
    files,
    main: main.path,
    args: project.args,
    stdin: stdinFor(project),
    limits: limitsFor(project, code),
    seed: 1,
    ...(test ? { test } : {}),
  };
}

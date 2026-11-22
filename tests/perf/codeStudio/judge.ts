// Judging a measurement against its gate, and the delay that proves a gate can fail. OPENNOTE_PERF_INJECT_MS adds that
// many milliseconds of busy work inside every timed section; OPENNOTE_PERF_INJECT_ONLY limits it to some gate ids
// (comma-separated). A gate that still passes with a delay of its own budget is not measuring anything.

import { gateOf, MODEL_GATES } from './budgets.ts';
import type { Gate, ModelGate } from './budgets.ts';

export type Status = 'pass' | 'fail' | 'skipped';

export interface GateResult {
  id: string;
  status: Status;
  /** The measured value in the gate's unit; absent when skipped. */
  value?: number;
  /** Why a gate was skipped. */
  reason?: string;
  /** The profile the number came from, such as `github-ubuntu-latest`. */
  machine?: string;
}

/** The delay to add inside the timed section of gate `id`, in milliseconds. */
export function injectedMs(id: string, env: NodeJS.ProcessEnv = process.env): number {
  const ms = Number(env.OPENNOTE_PERF_INJECT_MS ?? 0);
  if (!(ms > 0)) return 0;
  const only = env.OPENNOTE_PERF_INJECT_ONLY?.split(',').map((part) => part.trim());
  return !only || only.includes(id) ? ms : 0;
}

/** Waits `ms` by spinning, so the delay shows in the timer on every platform and cannot be skipped by a scheduler. */
export function spin(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* the delay is the work */
  }
}

/** Times `work` in milliseconds, with the gate's injected delay inside the timer. */
export function timed(id: string, work: () => void): number {
  const start = performance.now();
  work();
  spin(injectedMs(id));
  return performance.now() - start;
}

/** The same for work that waits. */
export async function timedAsync(id: string, work: () => Promise<unknown>): Promise<number> {
  const start = performance.now();
  await work();
  spin(injectedMs(id));
  return performance.now() - start;
}

export function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** The best of several runs of a median: other work on the machine only ever slows a run, never speeds it. */
export function best(runs: readonly number[]): number {
  return Math.min(...runs);
}

/** Pass when the value is at most the budget. */
export function judge(gate: Gate, value: number, machine?: string): GateResult {
  return { id: gate.id, status: value <= gate.budget ? 'pass' : 'fail', value, ...(machine ? { machine } : {}) };
}

export function skipped(id: string, reason: string): GateResult {
  gateOf(id);
  return { id, status: 'skipped', reason };
}

/** A model run passes when its first token comes within the budget and it generates at least the minimum speed. */
export function judgeModel(
  gate: ModelGate,
  firstTokenMs: number,
  tokensPerSecond: number,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  if (firstTokenMs > gate.firstTokenMs) problems.push(`first token ${firstTokenMs} ms is over ${gate.firstTokenMs} ms`);
  if (tokensPerSecond < gate.minTokensPerSecond) {
    problems.push(`${tokensPerSecond} tokens/s is under ${gate.minTokensPerSecond}`);
  }
  return { ok: problems.length === 0, problems };
}

export function modelGateOf(id: string): ModelGate {
  const gate = MODEL_GATES.find((candidate) => candidate.id === id);
  if (!gate) throw new Error(`No model gate named ${id}.`);
  return gate;
}

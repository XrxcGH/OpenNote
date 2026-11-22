// The nightly budget table: one row for every code studio gate, measured, or not. The table is Markdown, written to the
// job summary of the nightly run and copied into docs/perf/code-studio.md when someone records a run.

import { GATES, MODEL_GATES } from './budgets.ts';
import type { GateResult } from './judge.ts';

export interface ModelResult {
  id: string;
  status: 'pass' | 'fail' | 'skipped';
  firstTokenMs?: number;
  firstTokenP95Ms?: number;
  tokensPerSecond?: number;
  reason?: string;
}

const MARK = { pass: 'pass', fail: 'FAIL', skipped: 'not measured' } as const;

const show = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));

/** The gates table. A gate with no result shows as not measured, so a forgotten gate is visible in the table. */
export function gateTable(results: readonly GateResult[]): string {
  const rows = GATES.map((gate) => {
    const result = results.find((candidate) => candidate.id === gate.id);
    const status = result ? MARK[result.status] : MARK.skipped;
    const value = result?.value === undefined ? '-' : `${show(result.value)} ${gate.unit}`;
    const note = result?.reason ?? (result ? '' : 'No result in this run.');
    const outcome = `${status}${note ? `: ${note}` : ''}`;
    return `| ${gate.id} | ${gate.design} | ${gate.title} | ${show(gate.budget)} ${gate.unit} | ${value} | ${outcome} |`;
  });
  return [
    '| Gate | Design | What | Budget | Measured | Result |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** The model table: time to the first token and tokens per second for each code model. */
export function modelTable(results: readonly ModelResult[], machine: string): string {
  const rows = MODEL_GATES.map((gate) => {
    const result = results.find((candidate) => candidate.id === gate.id);
    const first = result?.firstTokenMs === undefined ? '-' : `${show(result.firstTokenMs)} ms`;
    const speed = result?.tokensPerSecond === undefined ? '-' : show(result.tokensPerSecond);
    const status = result ? MARK[result.status] : MARK.skipped;
    const note = result?.reason ? `: ${result.reason}` : '';
    return `| ${gate.id} | ${gate.model} | ${gate.firstTokenMs} ms | ${gate.minTokensPerSecond} | ${first} | ${speed} | ${status}${note} |`;
  });
  return [
    `Machine: ${machine}.`,
    '',
    '| Gate | Model | First token budget | Tokens/s at least | First token | Tokens/s | Result |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

/** True when no gate failed. A gate that was not measured does not fail the run; the table shows it. */
export function allPass(results: readonly GateResult[]): boolean {
  return results.every((result) => result.status !== 'fail');
}

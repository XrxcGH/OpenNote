// The code studio's performance gates (code studio DESIGN section 15) as data.
// Every gate has one row here and one row in the nightly budget table.
// Each gate has a check that fails when the measured value is over its budget.
// A gate is measured in one of four places.
// Node gates run in a plain Node process, with the studio's own modules bundled as the app bundles them (measure.ts).
// Browser gates run in the built app, through Playwright (studio.spec.ts).
// Pack gates run in Node, with a runtime that reaches the app as a pack download.
// The npm package of the same version stands in for the pack, and `--skip-packs` leaves these out.
// Model gates run with the language model program and a model file (model.ts), and are skipped without a model file.

export type Where = 'node' | 'browser' | 'pack' | 'model';

export interface Gate {
  /** Stable id: the row of the nightly table and the key of every result file. */
  readonly id: string;
  /** The gate's number in DESIGN section 15 or 14. */
  readonly design: string;
  readonly title: string;
  /** The most the measure may be, in `unit`. */
  readonly budget: number;
  readonly unit: 'ms' | 'MB';
  readonly where: Where;
  /** What the number is, so a reader of the table knows what was timed. */
  readonly measure: string;
}

export const GATES: readonly Gate[] = [
  {
    id: 'studio-open',
    design: 'G-U1',
    title: 'Studio open',
    budget: 400,
    unit: 'ms',
    where: 'browser',
    measure: 'From the open command to an editable editor, first time in the session.',
  },
  {
    id: 'typing-1000',
    design: 'G-U2',
    title: 'Typing in a 1,000-line file with diagnostics on',
    budget: 16,
    unit: 'ms',
    where: 'browser',
    measure: 'Key to screen, 95th percentile.',
  },
  {
    id: 'completion-list',
    design: 'G-C1',
    title: 'Completion list',
    budget: 50,
    unit: 'ms',
    where: 'node',
    measure: 'Median of cold samples in a 1,000-line Python file.',
  },
  {
    id: 'pattern-ghost',
    design: 'G-C2',
    title: 'Pattern ghost text',
    budget: 30,
    unit: 'ms',
    where: 'node',
    measure: 'Median of cold samples in a 1,000-line Python file, worse of automatic and explicit.',
  },
  {
    id: 'syntax-marks',
    design: 'G-D2',
    title: 'Syntax marks',
    budget: 100,
    unit: 'ms',
    where: 'node',
    measure: 'The layer pause plus one syntax run on a 1,000-line file, slowest language.',
  },
  {
    id: 'checker-marks',
    design: 'G-D2',
    title: 'Checker marks',
    budget: 400,
    unit: 'ms',
    where: 'node',
    measure: 'The layer pause plus one checker run on a 1,000-line file, slowest language.',
  },
  {
    id: 'run-quickjs',
    design: 'G-R1',
    title: 'Run start, JavaScript and TypeScript (QuickJS)',
    budget: 300,
    unit: 'ms',
    where: 'node',
    measure: 'A hello program on a loaded engine: from the run order to the end of the run.',
  },
  {
    id: 'run-micropython',
    design: 'G-R1',
    title: 'Run start, Python (MicroPython)',
    budget: 300,
    unit: 'ms',
    where: 'node',
    measure: 'A hello program on a loaded engine: from the run order to the end of the run.',
  },
  {
    id: 'run-lua',
    design: 'G-R1',
    title: 'Run start, Lua',
    budget: 300,
    unit: 'ms',
    where: 'node',
    measure: 'A hello program on a loaded engine: from the run order to the end of the run.',
  },
  {
    id: 'run-sql',
    design: 'G-R1',
    title: 'Run start, SQL',
    budget: 300,
    unit: 'ms',
    where: 'node',
    measure: 'A one-statement script on a loaded engine: from the run order to the end of the run.',
  },
  {
    id: 'run-pyodide-warm',
    design: 'G-R2',
    title: 'Run start, full Python (Pyodide), warm',
    budget: 300,
    unit: 'ms',
    where: 'pack',
    measure: 'A hello program on a loaded engine.',
  },
  {
    id: 'run-pyodide-cold',
    design: 'G-R2',
    title: 'Run start, full Python (Pyodide), cold',
    budget: 3000,
    unit: 'ms',
    where: 'pack',
    measure: 'Engine load plus the first hello program.',
  },
  {
    id: 'compile-c',
    design: 'G-R4',
    title: 'C compile, warm',
    budget: 1500,
    unit: 'ms',
    where: 'pack',
    measure: 'A 200-line C file, second compile after the toolchain is loaded.',
  },
  {
    id: 'compile-cpp',
    design: 'G-R4',
    title: 'C++ compile, warm',
    budget: 1500,
    unit: 'ms',
    where: 'pack',
    measure: 'A 200-line C++ file, second compile after the toolchain is loaded.',
  },
  {
    id: 'idle-memory',
    design: 'G-U3',
    title: 'Studio idle memory',
    budget: 60,
    unit: 'MB',
    where: 'browser',
    measure: 'JavaScript heap added by opening the studio, after a forced collection.',
  },
];

/** The ids of the gates, in table order. */
export const GATE_IDS: readonly string[] = GATES.map((gate) => gate.id);

export function gateOf(id: string): Gate {
  const gate = GATES.find((candidate) => candidate.id === id);
  if (!gate) throw new Error(`No code studio gate named ${id}.`);
  return gate;
}

/** Model gates (R2). The budgets are the design's: the 0.5B model's first token within 500 ms, the 1.5B within 1.2 s. */
export interface ModelGate {
  readonly id: string;
  readonly model: string;
  readonly file: string;
  readonly firstTokenMs: number;
  /** The slowest 95th percentile of the first token, when the design sets one (G-M1: 0.5B model only). */
  readonly firstTokenP95Ms?: number;
  /** The slowest the model may generate, as the lowest tokens per second that passes. */
  readonly minTokensPerSecond: number;
}

export const MODEL_GATES: readonly ModelGate[] = [
  {
    id: 'model-0.5b',
    model: 'Qwen2.5-Coder 0.5B Q8_0',
    file: 'qwen2.5-coder-0.5b-q8_0.gguf',
    firstTokenMs: 500,
    firstTokenP95Ms: 1200,
    minTokensPerSecond: 30,
  },
  {
    id: 'model-1.5b',
    model: 'Qwen2.5-Coder 1.5B Q8_0',
    file: 'qwen2.5-coder-1.5b-q8_0.gguf',
    firstTokenMs: 1200,
    minTokensPerSecond: 12,
  },
  {
    id: 'model-1.5b-instruct',
    model: 'Qwen2.5-Coder 1.5B Instruct Q4_K_M',
    file: 'qwen2.5-coder-1.5b-instruct-q4_k_m.gguf',
    firstTokenMs: 1200,
    minTokensPerSecond: 15,
  },
];

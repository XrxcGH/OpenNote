// The debugger's one contract: a subset of the Debug Adapter Protocol (DAP, its published specification),
// plus the trace that in-app runtimes record and replay (DESIGN 8, ADR 0073). Field names follow the DAP
// specification exactly, so installed adapters (gdb, lldb-dap, debugpy, and Go's) speak it through the runner
// unchanged. Lane code:L14a implements it for the in-app runtimes; lane code:L14b's UI only knows these types.

import type { RunRequest } from './run';

// ---- Shared DAP types (the fields of the subset) ----

/** A source file. In-app runtimes use the project path as `path`. */
export interface Source {
  name?: string;
  path?: string;
  sourceReference?: number;
}

/** A breakpoint the client asks for. Lines start at 1 unless initialize said otherwise. */
export interface SourceBreakpoint {
  line: number;
  column?: number;
  condition?: string;
  hitCondition?: string;
  logMessage?: string;
}

/** A breakpoint as the adapter set it. */
export interface Breakpoint {
  id?: number;
  verified: boolean;
  message?: string;
  source?: Source;
  line?: number;
  column?: number;
}

export interface ExceptionBreakpointsFilter {
  filter: string;
  label: string;
  description?: string;
  default?: boolean;
}

/** What the adapter can do. In-app runtimes report step back, since replay gives it for free. */
export interface Capabilities {
  supportsConfigurationDoneRequest?: boolean;
  supportsConditionalBreakpoints?: boolean;
  supportsHitConditionalBreakpoints?: boolean;
  supportsLogPoints?: boolean;
  supportsStepBack?: boolean;
  supportsEvaluateForHovers?: boolean;
  supportsTerminateRequest?: boolean;
  exceptionBreakpointFilters?: ExceptionBreakpointsFilter[];
}

export interface StackFrame {
  id: number;
  name: string;
  source?: Source;
  line: number;
  column: number;
}

export interface Scope {
  name: string;
  presentationHint?: 'arguments' | 'locals' | 'registers' | 'returnValue' | (string & {});
  /** Pass to `variables`; 0 means no children. */
  variablesReference: number;
  expensive: boolean;
}

export interface Variable {
  name: string;
  value: string;
  type?: string;
  evaluateName?: string;
  variablesReference: number;
}

export type SteppingGranularity = 'statement' | 'line' | 'instruction';

// ---- Request arguments ----

export interface InitializeArguments {
  clientID?: string;
  clientName?: string;
  adapterID: string;
  locale?: string;
  linesStartAt1?: boolean;
  columnsStartAt1?: boolean;
  pathFormat?: 'path' | 'uri';
}

/** DAP lets each adapter add launch fields; OpenNote's in-app adapter reads `run`. */
export interface LaunchArguments {
  noDebug?: boolean;
  run?: RunRequest;
}

export interface SetBreakpointsArguments {
  source: Source;
  breakpoints?: SourceBreakpoint[];
  sourceModified?: boolean;
}

export interface SetExceptionBreakpointsArguments {
  filters: string[];
}

/** The arguments of every step request: continue, next, stepIn, stepOut, stepBack, and reverseContinue. */
export interface StepArguments {
  threadId: number;
  singleThread?: boolean;
  granularity?: SteppingGranularity;
}

export interface StackTraceArguments {
  threadId: number;
  startFrame?: number;
  levels?: number;
}

export interface ScopesArguments {
  frameId: number;
}

export interface VariablesArguments {
  variablesReference: number;
  filter?: 'indexed' | 'named';
  start?: number;
  count?: number;
}

export interface EvaluateArguments {
  expression: string;
  frameId?: number;
  context?: 'watch' | 'repl' | 'hover' | 'clipboard' | 'variables' | (string & {});
}

export interface TerminateArguments {
  restart?: boolean;
}

/** The subset of requests (DESIGN 8.1), each with its arguments and its response body. */
export interface DebugRequestMap {
  initialize: { arguments: InitializeArguments; body: Capabilities };
  launch: { arguments: LaunchArguments; body: undefined };
  setBreakpoints: { arguments: SetBreakpointsArguments; body: { breakpoints: Breakpoint[] } };
  setExceptionBreakpoints: { arguments: SetExceptionBreakpointsArguments; body: { breakpoints?: Breakpoint[] } };
  configurationDone: { arguments: Record<string, never>; body: undefined };
  continue: { arguments: StepArguments; body: { allThreadsContinued?: boolean } };
  next: { arguments: StepArguments; body: undefined };
  stepIn: { arguments: StepArguments & { targetId?: number }; body: undefined };
  stepOut: { arguments: StepArguments; body: undefined };
  stepBack: { arguments: StepArguments; body: undefined };
  reverseContinue: { arguments: StepArguments; body: undefined };
  stackTrace: { arguments: StackTraceArguments; body: { stackFrames: StackFrame[]; totalFrames?: number } };
  scopes: { arguments: ScopesArguments; body: { scopes: Scope[] } };
  variables: { arguments: VariablesArguments; body: { variables: Variable[] } };
  evaluate: {
    arguments: EvaluateArguments;
    body: { result: string; type?: string; variablesReference: number };
  };
  terminate: { arguments: TerminateArguments; body: undefined };
}

/** The request names of the subset, in the order DESIGN 8.1 lists them. */
export const DEBUG_COMMANDS = [
  'initialize',
  'launch',
  'setBreakpoints',
  'setExceptionBreakpoints',
  'configurationDone',
  'continue',
  'next',
  'stepIn',
  'stepOut',
  'stepBack',
  'reverseContinue',
  'stackTrace',
  'scopes',
  'variables',
  'evaluate',
  'terminate',
] as const satisfies readonly (keyof DebugRequestMap)[];
export type DebugCommand = (typeof DEBUG_COMMANDS)[number];

// ---- Messages ----

/** Every DAP message has a sequence number and a type. */
export interface ProtocolMessage {
  seq: number;
  type: 'request' | 'response' | 'event';
}

export interface DebugRequest<C extends DebugCommand = DebugCommand> extends ProtocolMessage {
  type: 'request';
  command: C;
  /**
   * Required here, on purpose: DAP makes it optional. The client always sends it, `{}` when empty. A reader
   * (the Rust DAP proxy included) must still accept a request without it, as DAP allows.
   */
  arguments: DebugRequestMap[C]['arguments'];
}

/** A response. `message` says why when `success` is false; `body` is there when it succeeds. */
export interface DebugResponse<C extends DebugCommand = DebugCommand> extends ProtocolMessage {
  type: 'response';
  request_seq: number;
  success: boolean;
  command: C;
  message?: string;
  body?: DebugRequestMap[C]['body'];
}

export type StoppedReason = 'step' | 'breakpoint' | 'exception' | 'pause' | 'entry' | 'goto' | (string & {});

/** The events of the subset. `initialized` tells the client to send breakpoints and then configurationDone. */
export interface DebugEventMap {
  initialized: undefined;
  stopped: {
    reason: StoppedReason;
    description?: string;
    threadId?: number;
    text?: string;
    allThreadsStopped?: boolean;
    hitBreakpointIds?: number[];
  };
  output: {
    category?: 'console' | 'important' | 'stdout' | 'stderr' | (string & {});
    output: string;
    source?: Source;
    line?: number;
  };
  terminated: { restart?: unknown };
  exited: { exitCode: number };
}

export const DEBUG_EVENTS = [
  'initialized',
  'stopped',
  'output',
  'terminated',
  'exited',
] as const satisfies readonly (keyof DebugEventMap)[];

export type DebugEvent = {
  [E in keyof DebugEventMap]: ProtocolMessage & { type: 'event'; event: E; body?: DebugEventMap[E] };
}[keyof DebugEventMap];

/** One debug session, in the app (trace replay) or through the runner (an installed adapter). */
export interface DebugSession {
  request<C extends DebugCommand>(command: C, args: DebugRequestMap[C]['arguments']): Promise<DebugResponse<C>>;
  /** Listens to events; returns the function that stops listening. */
  onEvent(listener: (event: DebugEvent) => void): () => void;
}

// ---- Trace replay (tier 1) ----

/** Recording caps per run (DESIGN 8.2). Past a cap, recording stops, and the program runs to the end. */
export const TRACE_LIMITS = {
  events: 20_000,
  bytes: 32 * 1024 * 1024,
  previewChars: 200,
  previewDepth: 2,
  previewEntries: 50,
} as const;

/**
 * A bounded view of a value: its type, at most 200 characters of text, and children to depth 2. A shared
 * reference shows once; later places carry `sameAs`, the path of that first place.
 */
export interface Preview {
  type: string;
  text: string;
  children?: { key: string; value: Preview }[];
  sameAs?: string;
  /** True when entries past the cap were left out. */
  truncated?: boolean;
}

/** One recorded step. `i` counts from 0; `stdout` is how many output characters were written before it. */
export interface TraceEvent {
  i: number;
  kind: 'line' | 'call' | 'return' | 'exception';
  /** The project path. */
  file: string;
  line: number;
  depth: number;
  frame: number;
  fn: string;
  locals: Record<string, Preview>;
  stdout: number;
  watches?: Record<string, Preview>;
}

/** What a recording run applies while it records: breakpoints by project path, and watch expressions. */
export interface TraceOptions {
  breakpoints: Record<string, SourceBreakpoint[]>;
  watches: string[];
  maxEvents: number;
  maxBytes: number;
}

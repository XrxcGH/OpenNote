// Type-level tests of the code studio contracts. tsc checks the expectTypeOf lines (npm run typecheck); vitest
// checks the lists. Expected DAP field names come from the Debug Adapter Protocol specification; the request
// and event lists, caps and modes come from the code studio design: sections 3.1, 4.1, 8, and 9.
// vitest alone does not enforce the expectTypeOf lines. Run npm run typecheck to catch a type regression.

import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  COMPARE_MODES,
  DEBUG_COMMANDS,
  DEBUG_EVENTS,
  PROJECT_LIMITS,
  RUNTIME_IDS,
  SEVERITIES,
  TEST_DEFAULTS,
  TRACE_LIMITS,
  type CodeFile,
  type CodeProject,
  type CodeProjectBlock,
  type DebugCommand,
  type DebugEventMap,
  type DebugRequest,
  type DebugRequestMap,
  type DebugResponse,
  type DebugSession,
  type SourceBreakpoint,
  type StackFrame,
  type Variable,
  type WorkerMessage,
} from '..';

describe('the debug session contract', () => {
  it('lists the DAP subset of the design, and only it', () => {
    expect([...DEBUG_COMMANDS]).toEqual([
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
    ]);
    expect([...DEBUG_EVENTS]).toEqual(['initialized', 'stopped', 'output', 'terminated', 'exited']);
    expectTypeOf<DebugCommand>().toEqualTypeOf<keyof DebugRequestMap>();
    expectTypeOf<(typeof DEBUG_EVENTS)[number]>().toEqualTypeOf<keyof DebugEventMap>();
  });

  it('uses the field names of a DAP request and response', () => {
    expectTypeOf<keyof DebugRequest>().toEqualTypeOf<'seq' | 'type' | 'command' | 'arguments'>();
    expectTypeOf<keyof DebugResponse>().toEqualTypeOf<
      'seq' | 'type' | 'request_seq' | 'success' | 'command' | 'message' | 'body'
    >();
    expectTypeOf<DebugResponse['request_seq']>().toEqualTypeOf<number>();
    expectTypeOf<DebugResponse['success']>().toEqualTypeOf<boolean>();
    expectTypeOf<DebugRequest<'setBreakpoints'>['command']>().toEqualTypeOf<'setBreakpoints'>();
  });

  it('uses the DAP field names of the subset arguments and bodies', () => {
    expectTypeOf<keyof SourceBreakpoint>().toEqualTypeOf<
      'line' | 'column' | 'condition' | 'hitCondition' | 'logMessage'
    >();
    expectTypeOf<DebugRequestMap['setBreakpoints']['arguments']>().toHaveProperty('source');
    expectTypeOf<DebugRequestMap['setBreakpoints']['body']>().toHaveProperty('breakpoints');
    expectTypeOf<DebugRequestMap['next']['arguments']['threadId']>().toEqualTypeOf<number>();
    expectTypeOf<DebugRequestMap['scopes']['arguments']>().toEqualTypeOf<{ frameId: number }>();
    expectTypeOf<DebugRequestMap['variables']['arguments']['variablesReference']>().toEqualTypeOf<number>();
    expectTypeOf<DebugRequestMap['evaluate']['arguments']['expression']>().toEqualTypeOf<string>();
    expectTypeOf<DebugRequestMap['stackTrace']['body']['stackFrames']>().toEqualTypeOf<StackFrame[]>();
    expectTypeOf<Pick<StackFrame, 'id' | 'name' | 'line' | 'column'>>().toEqualTypeOf<{
      id: number;
      name: string;
      line: number;
      column: number;
    }>();
    expectTypeOf<Pick<Variable, 'name' | 'value' | 'variablesReference'>>().toEqualTypeOf<{
      name: string;
      value: string;
      variablesReference: number;
    }>();
    expectTypeOf<DebugEventMap['stopped']['reason']>().toExtend<string>();
    expectTypeOf<DebugEventMap['exited']>().toEqualTypeOf<{ exitCode: number }>();
  });

  it('answers each request with the response of the same command', () => {
    const session = {} as DebugSession;
    expectTypeOf(session.request<'scopes'>).returns.resolves.toEqualTypeOf<DebugResponse<'scopes'>>();
    expectTypeOf(session.request<'scopes'>)
      .parameter(1)
      .toEqualTypeOf<{ frameId: number }>();
  });
});

describe('the code project contract', () => {
  it('keys files and tests by ID, never as arrays, so a merge patch changes one file alone', () => {
    expectTypeOf<CodeProject['files']>().toEqualTypeOf<Record<string, CodeFile>>();
    expectTypeOf<CodeProject['files']>().not.toBeArray();
    expectTypeOf<CodeProject['tests']>().not.toBeArray();
    expectTypeOf<CodeFile>().toEqualTypeOf<{ path: string; text: string; order: number }>();
  });

  it('carries the limits of the design', () => {
    expect(PROJECT_LIMITS).toEqual({
      files: 200,
      pathChars: 255,
      fileBytes: 1_048_576,
      projectBytes: 4_194_304,
      tests: 500,
      fallbackBytes: 262_144,
    });
  });
});

describe('the run, diagnostics and test contracts', () => {
  it('lists the in-app runtimes, severities, compare modes and caps of the design', () => {
    expect([...RUNTIME_IDS]).toEqual([
      'python-quick',
      'python-full',
      'javascript',
      'typescript',
      'sql',
      'lua',
      'c',
      'cpp',
      'ruby',
      'r',
    ]);
    expect([...SEVERITIES]).toEqual(['error', 'warning', 'info', 'hint']);
    expect([...COMPARE_MODES]).toEqual(['exact', 'trim', 'tokens', 'number', 'lines-unordered', 'regex']);
    expect(TEST_DEFAULTS).toEqual({ tolerance: 0.000001, timeMs: 2000 });
    expect(TRACE_LIMITS.events).toBe(20_000);
    expect(TRACE_LIMITS.bytes).toBe(33_554_432);
  });

  it('names every worker message kind of protocol version 2', () => {
    expectTypeOf<WorkerMessage['kind']>().toEqualTypeOf<
      'loading' | 'compiling' | 'started' | 'out' | 'input-wanted' | 'rich' | 'diagnostic' | 'trace' | 'test' | 'done'
    >();
  });
});

describe('the code project block contract', () => {
  it('takes the extension-block fallback of format spec 6.5, with an optional image asset ID', () => {
    expectTypeOf<CodeProjectBlock['fallback']>().toEqualTypeOf<{ markdown: string; image?: string }>();
    const fallback: CodeProjectBlock['fallback'] = { markdown: '# main.py', image: 'asset-1' };
    expect(fallback.image).toBe('asset-1');
  });
});

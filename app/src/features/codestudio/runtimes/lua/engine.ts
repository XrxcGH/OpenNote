// The Lua runtime over wasmoon (Lua 5.4 as WebAssembly, DESIGN 2.1, 4). Each run gets a fresh Lua state from one
// shared module. The program runs in a coroutine, so io.read can wait for the page's input where the engine
// allows it, and the time limit is checked by a count hook. `math.randomseed` gets the run's seed, so the same seed
// gives the same numbers.

import type { LuaEngine, LuaFactory } from 'wasmoon';
import type { Emit, RunContext, RunEnd, RunFile, RunRequest, RuntimeDiagnostic } from '../../contracts/run';
import { t } from '../../../../strings/t';
import { syntaxDiagnostics } from './diagnostics';
import { PRELUDE } from './prelude';

/** The text of the error os.exit raises inside the program, after it has told the host the exit code. */
const EXIT = 'os.exit';

export function newState(factory: LuaFactory): Promise<LuaEngine> {
  return factory.createEngine({
    openStandardLibs: true,
    injectObjects: false,
    enableProxy: false,
    traceAllocations: true,
  });
}

export interface Host {
  out(text: string): void;
  err(text: string): void;
  line(): Promise<string | undefined>;
  rest(): string | undefined;
  exit(code: number): void;
  read(path: string): string | undefined;
  write(path: string, text: string): boolean;
  messages: Record<string, string>;
}

/** The messages the prelude formats with string.format, so each placeholder is left as a Lua one. */
function messages(): Record<string, string> {
  return {
    exit: EXIT,
    noModule: t('codeStudio.sqlLua.lua.noModule', { path: '%s' }),
    noFile: t('codeStudio.sqlLua.lua.noFile', { path: '%s' }),
    notWritable: t('codeStudio.sqlLua.lua.notWritable', { path: '%s' }),
    formatBad: t('codeStudio.sqlLua.lua.formatBad', { index: '%d' }),
    closedFile: t('codeStudio.sqlLua.lua.closedFile'),
    badFd: t('codeStudio.sqlLua.lua.badFd'),
  };
}

/** The functions the prelude keeps (prelude.ts). Page-bound ones go through `context`. */
function hostFor(emit: Emit, context: RunContext, exited: { code: number | null }): Host {
  const out = (stream: 'out' | 'err') => (text: string) => emit({ kind: 'out', stream, text });
  return {
    out: out('out'),
    err: out('err'),
    line: () => context.stdin.lineAsync('').then((line) => line ?? undefined),
    rest: () => context.stdin.read() ?? undefined,
    exit: (code) => void (exited.code = Number.isFinite(code) ? Math.trunc(code) : 1),
    read: (path) => context.files.read(path) ?? undefined,
    write: (path, text) => context.files.write(path, text),
    messages: messages(),
  };
}

/** Loads the prelude into `state`. Returns the function that checks source text for syntax errors. */
export function installPrelude(state: LuaEngine, host: Host): (source: string, name: string) => string | null {
  state.global.set('__host', host);
  return state.doStringSync(PRELUDE) as (source: string, name: string) => string | null;
}

function endOf(error: unknown, exited: { code: number | null }): RunEnd {
  const text = error instanceof Error ? error.message : String(error);
  if (exited.code !== null) return { status: exited.code === 0 ? 'ok' : 'error', exitCode: exited.code, message: '' };
  if (/thread timeout exceeded/.test(text)) return { status: 'time', message: '' };
  if (/not enough memory/i.test(text)) return { status: 'memory', message: '' };
  return { status: 'error', exitCode: 1, message: text.split('\n')[0] ?? text };
}

/** The traceback of a Lua error without the frames inside the prelude, which the program did not write. */
function withoutPrelude(message: string): string {
  return message
    .split('\n')
    .filter((line) => !line.startsWith('\t[string "..."]'))
    .join('\n');
}

/** Runs `request.main` in a fresh state. An error prints to the error stream as `lua: <message>`. */
export async function runLua(
  factory: LuaFactory,
  request: RunRequest,
  emit: Emit,
  context: RunContext,
): Promise<RunEnd> {
  const exited: { code: number | null } = { code: null };
  const state = await newState(factory);
  const { global } = state;
  try {
    installPrelude(state, hostFor(emit, context, exited));
    const source = request.files.find((file) => file.path === request.main)?.text;
    if (source === undefined) return { status: 'failed', message: request.main };
    global.setMemoryMax(global.getMemoryUsed() + request.limits.memoryBytes);
    // The `arg` table is the program's name at 0 and its arguments from 1, as the lua program makes it.
    global.set('__main', request.main);
    global.set('__args', request.args);
    state.doStringSync('arg = { [0] = __main, table.unpack(__args) }; __main, __args = nil, nil');
    state.doStringSync(`math.randomseed(${Math.trunc(request.seed)})`);
    const thread = global.newThread();
    thread.setTimeout(Date.now() + Math.max(0, context.deadline - performance.now()));
    thread.loadString(source, `@${request.main}`);
    await thread.run(0);
    return { status: 'ok', message: '' };
  } catch (error) {
    const end = endOf(error, exited);
    if (end.status === 'error' && exited.code === null) {
      const message = withoutPrelude(error instanceof Error ? error.message : String(error));
      emit({ kind: 'out', stream: 'err', text: `lua: ${message}\n` });
    }
    return end;
  } finally {
    state.global.close();
  }
}

/** The diagnostics for a file that does not compile, from Lua's own load function; none when it does. */
export async function checkLua(factory: LuaFactory, file: RunFile): Promise<RuntimeDiagnostic[]> {
  const state = await newState(factory);
  try {
    const nothing = () => undefined;
    const host: Host = {
      out: nothing,
      err: nothing,
      line: async () => undefined,
      rest: () => undefined,
      exit: nothing,
      read: () => undefined,
      write: () => false,
      messages: {},
    };
    return syntaxDiagnostics(installPrelude(state, host)(file.text, file.path), file);
  } finally {
    state.global.close();
  }
}

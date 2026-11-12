// One run or one check inside a loaded Python runtime (DESIGN 4.3 to 4.6). MicroPython and Pyodide share it.
// The project goes into the runtime's in-memory file system (Emscripten's MEMFS), the program runs through
// prelude.ts, and the files it wrote or changed go back to the run's overlay. Neither runtime can reach the page:
// MicroPython's JavaScript table is cut off at load, and Pyodide's js modules are refused before the program runs.

import type { Emit, RunContext, RunEnd, RunFile, RunRequest, RuntimeDiagnostic, Stream } from '../../contracts/run';
import { mapDiagnostics } from '../../run/diagnostics';
import { isProjectPath } from '../../run/mount';
import { CHECKED_FILE, CHECK_FILE, CHECK_SOURCE, HOME, RUN_FILE, RUN_SOURCE, SCRATCH, STATE_FILE } from './prelude';
import type { PythonChecked, PythonState } from './prelude';
import { pythonMapper } from './traceback';

/** The part of Emscripten's FS object both runtimes expose. */
export interface EmscriptenFS {
  mkdir(path: string): void;
  writeFile(path: string, data: string | Uint8Array): void;
  readFile(path: string): Uint8Array;
  readdir(path: string): string[];
  stat(path: string): { mode: number };
  isDir(mode: number): boolean;
  unlink(path: string): void;
  rmdir(path: string): void;
  analyzePath(path: string): { exists: boolean };
  chdir(path: string): void;
}

/** A loaded runtime. `exec` runs Python at the top level and throws when the runtime itself fails. */
export interface PythonEngine {
  fs: EmscriptenFS;
  exec(source: string): void;
  /** Where the runtime's output bytes go; set for each run. */
  sink: (stream: Stream, bytes: Uint8Array) => void;
  /** Lets the program's heap grow by at most `bytes` past its size after load. Absent: the heap is fixed at load. */
  limitMemory?(bytes: number): void;
}

/** Files read back after a run, at most. The overlay has its own, smaller limit. */
const MAX_WALK = 2_000;

function exists(fs: EmscriptenFS, path: string): boolean {
  return fs.analyzePath(path).exists;
}

function makeFolders(fs: EmscriptenFS, path: string): void {
  let at = '';
  for (const part of path.split('/').filter(Boolean)) {
    at += `/${part}`;
    if (!exists(fs, at)) fs.mkdir(at);
  }
}

function removeTree(fs: EmscriptenFS, path: string): void {
  if (!exists(fs, path)) return;
  if (!fs.isDir(fs.stat(path).mode)) return fs.unlink(path);
  for (const name of fs.readdir(path)) if (name !== '.' && name !== '..') removeTree(fs, `${path}/${name}`);
  fs.rmdir(path);
}

/** Every file under `root`, as project paths. */
function walk(fs: EmscriptenFS, root: string): string[] {
  const found: string[] = [];
  const visit = (folder: string, prefix: string) => {
    for (const name of fs.readdir(folder)) {
      if (name === '.' || name === '..' || found.length >= MAX_WALK) continue;
      const full = `${folder}/${name}`;
      if (fs.isDir(fs.stat(full).mode)) visit(full, `${prefix}${name}/`);
      else found.push(`${prefix}${name}`);
    }
  };
  visit(root, '');
  return found;
}

function readText(fs: EmscriptenFS, path: string): string | null {
  try {
    // A byte order mark is kept, so a project file that starts with one reads back as it was mounted.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFile(path));
  } catch {
    return null;
  }
}

/** Puts the project under HOME, replacing what an earlier run left there. */
function mountProject(fs: EmscriptenFS, files: readonly RunFile[]): void {
  // The last run left the working folder inside the project, and a folder in use cannot be removed.
  fs.chdir('/');
  removeTree(fs, HOME);
  makeFolders(fs, HOME);
  makeFolders(fs, SCRATCH);
  for (const file of files) {
    if (!isProjectPath(file.path)) continue;
    const slash = file.path.lastIndexOf('/');
    if (slash > 0) makeFolders(fs, `${HOME}/${file.path.slice(0, slash)}`);
    fs.writeFile(`${HOME}/${file.path}`, file.text);
  }
}

/** Sends the files the program added or changed to the run's overlay. A file that is not UTF-8 text is skipped. */
function collectWrites(fs: EmscriptenFS, files: readonly RunFile[], context: RunContext): void {
  const before = new Map(files.map((file) => [file.path, file.text]));
  for (const path of walk(fs, HOME)) {
    const text = readText(fs, `${HOME}/${path}`);
    if (text === null || before.get(path) === text) continue;
    context.files.write(path, text);
  }
}

function readJson<T>(fs: EmscriptenFS, path: string): T | null {
  if (!exists(fs, path)) return null;
  const text = readText(fs, path);
  fs.unlink(path);
  try {
    return text === null ? null : (JSON.parse(text) as T);
  } catch {
    return null;
  }
}

/** UTF-8 output, decoded across byte boundaries, one decoder per stream. */
function outputTo(emit: Emit): { write(stream: Stream, bytes: Uint8Array): void; end(): void } {
  const decoders = { out: new TextDecoder(), err: new TextDecoder() };
  return {
    write(stream, bytes) {
      const text = decoders[stream].decode(bytes, { stream: true });
      if (text !== '') emit({ kind: 'out', stream, text });
    },
    end() {
      for (const stream of ['out', 'err'] as const) {
        const text = decoders[stream].decode();
        if (text !== '') emit({ kind: 'out', stream, text });
      }
    },
  };
}

/** How a run that the runtime itself ended (not the program) is reported. */
function runtimeFailure(error: unknown): RunEnd {
  const text = String((error as Error)?.message ?? error);
  if (/memory|MemoryError|Cannot enlarge memory/i.test(text)) return { status: 'memory', message: 'MemoryError' };
  return { status: 'error', exitCode: 1, message: text.split('\n')[0]!.slice(0, 200) };
}

/** Runs one request in `engine`. */
export function runPython(engine: PythonEngine, request: RunRequest, emit: Emit, context: RunContext): RunEnd {
  const { fs } = engine;
  mountProject(fs, request.files);
  const settings = {
    home: HOME,
    main: request.main,
    args: request.args,
    seed: request.seed,
    stdin: request.stdin.text.replace(/\r\n?/g, '\n'),
  };
  fs.writeFile(RUN_FILE, JSON.stringify(settings));
  engine.limitMemory?.(request.limits.memoryBytes);
  const output = outputTo(emit);
  engine.sink = output.write;
  let failure: RunEnd | null = null;
  try {
    engine.exec(RUN_SOURCE);
  } catch (error) {
    failure = runtimeFailure(error);
  } finally {
    output.end();
    engine.sink = () => undefined;
  }
  const state = readJson<PythonState>(fs, STATE_FILE);
  if (exists(fs, RUN_FILE)) fs.unlink(RUN_FILE);
  collectWrites(fs, request.files, context);
  if (state?.wantedInput) {
    // The program read past the end of the input: the run's Stdin records it for the console's note.
    context.stdin.read();
    context.stdin.line();
  }
  if (failure) return failure;
  if (!state) return { status: 'error', exitCode: 1, message: '' };
  if (state.kind === 'MemoryError') return { status: 'memory', exitCode: 1, message: 'MemoryError' };
  return readState(state);
}

/**
 * How the state the Python side wrote ends the run. The page refuses an exit code that is not an integer within
 * 2^31, and a refused `done` would leave the run waiting for its time limit, so such a code becomes 1.
 */
function readState(state: PythonState): RunEnd {
  const message = typeof state.kind === 'string' ? state.kind : '';
  const exit: unknown = state.exit;
  if (typeof exit !== 'number' || !Number.isInteger(exit) || Math.abs(exit) > 2 ** 31) {
    return { status: 'error', exitCode: 1, message };
  }
  return { status: state.status === 'ok' && exit === 0 ? 'ok' : 'error', exitCode: exit, message };
}

/** Compiles one file without running it: the syntax error it has, if any, as diagnostics (DESIGN 6.1, L-c). */
export function checkPython(engine: PythonEngine, file: RunFile, files: readonly RunFile[]): RuntimeDiagnostic[] {
  const { fs } = engine;
  makeFolders(fs, SCRATCH);
  fs.writeFile(CHECK_FILE, JSON.stringify({ home: HOME, path: file.path, text: file.text }));
  try {
    engine.exec(CHECK_SOURCE);
  } catch {
    return [];
  } finally {
    if (exists(fs, CHECK_FILE)) fs.unlink(CHECK_FILE);
  }
  const found = readJson<PythonChecked>(fs, CHECKED_FILE);
  if (!found || found.ok || !found.text) return [];
  const known = files.some((item) => item.path === file.path) ? files : [...files, file];
  const items = mapDiagnostics(pythonMapper, found.text, known).filter((item) => item.file === file.path);
  const item = items[items.length - 1];
  if (!item) return [];
  // CPython gives the exact place; MicroPython gives the line only, which the traceback already holds.
  const lineCount = file.text.split('\n').length;
  const line = typeof found.line === 'number' && found.line >= 1 ? Math.min(found.line, lineCount) : item.line;
  const column = typeof found.column === 'number' && found.column >= 1 ? found.column : undefined;
  return [{ ...item, line, ...(column === undefined ? {} : { column }) }];
}

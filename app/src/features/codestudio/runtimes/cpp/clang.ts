// The clang pack inside a worker (ADR 0070). It is YoWASP's clang and lld 22: one WebAssembly module that runs as
// clang, clang++, or wasm-ld. load() fetches and compiles the module and unpacks the C and C++ libraries. It runs
// while the worker is warm, before lockdown takes fetch away. Every later command reuses the compiled module and runs
// synchronously, so a compile needs no timers and no network.

import type { RunFile } from '../../contracts/run';
import { OUTPUT, PROJECT_DIR } from './flags';

/** YoWASP's file tree: a folder maps names to folders, text, or bytes. */
export interface Tree {
  [name: string]: Tree | string | Uint8Array;
}

type Output = (bytes: Uint8Array | null) => void;

interface RunOptions {
  stdout?: Output | null;
  stderr?: Output | null;
  decodeASCII?: boolean;
  synchronously?: boolean;
  /** Read even when stdout and stderr are given; without it the bundle reads console.log, which lockdown removes. */
  printLine?: (line: string) => void;
  fetchProgress?: (event: { totalLength: number; doneLength: number }) => void;
}

type Command = (args?: string[] | null, files?: Tree, options?: RunOptions) => Promise<Tree> | Tree | undefined;

/** What the pack's bundle.js exports (its lib/api.d.ts). */
export interface ClangModule {
  runLLVM: Command;
  commands: Record<'clang' | 'clang++' | 'wasm-ld', Command>;
}

export type ImportClang = () => Promise<ClangModule>;

export interface CommandResult {
  /** The exit status: 0 when the command worked. */
  code: number;
  /** What the command printed to its two streams, in the order written. */
  text: string;
  files: Tree | null;
}

/** The project as a tree under PROJECT_DIR, with an empty folder for the program. */
export function projectTree(files: readonly RunFile[]): Tree {
  const project: Tree = {};
  for (const file of files) {
    const parts = file.path.split('/');
    let folder = project;
    for (const part of parts.slice(0, -1)) {
      const next = folder[part];
      if (next instanceof Uint8Array || typeof next === 'string') break;
      folder = next ?? (folder[part] = {});
    }
    folder[parts[parts.length - 1]!] = file.text;
  }
  return { [PROJECT_DIR.slice(1)]: project, [OUTPUT.split('/')[1]!]: {} };
}

/** The file at an absolute path of a tree, or null. */
export function fileAt(tree: Tree | null, path: string): Uint8Array | null {
  let node: Tree | string | Uint8Array | undefined = tree ?? undefined;
  for (const part of path.split('/').filter(Boolean)) {
    if (node === undefined || node instanceof Uint8Array || typeof node === 'string') return null;
    node = node[part];
  }
  return node instanceof Uint8Array ? node : null;
}

export class Clang {
  /** clang's version, such as "22.1.0", read once it has loaded. */
  version = '';
  private module: ClangModule | null = null;
  private loading: Promise<void> | null = null;

  constructor(private readonly importClang: ImportClang) {}

  get loaded(): boolean {
    return this.module !== null;
  }

  /** Fetches the pack's files and compiles clang once; later calls wait for the same load. */
  load(onProgress: (percent: number) => void = () => {}): Promise<void> {
    this.loading ??= (async () => {
      const module = await this.importClang();
      await module.runLLVM(
        null,
        {},
        {
          fetchProgress: ({ totalLength, doneLength }) =>
            onProgress(totalLength > 0 ? Math.floor((95 * doneLength) / totalLength) : 0),
        },
      );
      // The first command builds the instance once, so a run after lockdown starts at once.
      const version = tool(module, ['clang', '--version'], {});
      this.version = /clang version (\S+)/.exec(version.text)?.[1] ?? '';
      if (version.code !== 0 || this.version === '') throw new Error('clang');
      this.module = module;
    })();
    return this.loading;
  }

  /** Runs clang (or clang++) with `args` over the project's files. */
  run(command: 'clang' | 'clang++', args: string[], files: readonly RunFile[]): CommandResult {
    if (!this.module) throw new Error('clang');
    return drive(this.module, command, args, projectTree(files));
  }
}

/** clang -### starts with these lines about itself. */
const ABOUT = /^(clang version |Target: |Thread model: |InstalledDir: |Build config: )/;

/** One command line of clang -###: each argument in double quotes, with \", \\ and \$ escaped. */
export function commandOf(line: string): string[] {
  const args = [...line.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) =>
    match[1] === undefined ? match[2]! : match[1].replace(/\\(.)/g, '$1'),
  );
  return args[0] === '' ? args.slice(1) : args;
}

/**
 * clang's driver in the worker. clang -### prints the steps a compile takes (the compiler, then wasm-ld) without
 * running them; each step then runs on its own in the same file tree. The pack's own driver does the same, but it
 * reads console.log on the way, and lockdown has removed console.
 */
function drive(module: ClangModule, command: 'clang' | 'clang++', args: string[], tree: Tree): CommandResult {
  const plan = tool(module, [command, '-###', ...args], tree);
  const lines = plan.text.split('\n');
  const said = lines.filter((line) => line !== '' && !ABOUT.test(line) && !line.startsWith(' "')).join('\n');
  if (plan.code !== 0) return { code: plan.code, text: said === '' ? '' : `${said}\n`, files: null };
  let files = tree;
  let text = said === '' ? '' : `${said}\n`;
  for (const line of lines.filter((each) => each.startsWith(' "'))) {
    const step = tool(module, commandOf(line), files);
    text += step.text;
    if (step.code !== 0 || !step.files) return { code: step.code || 1, text, files: step.files };
    files = step.files;
  }
  return { code: 0, text, files };
}

/** Runs one tool of the LLVM module (clang, clang++, wasm-ld) and keeps what it printed. */
function tool(module: ClangModule, argv: string[], tree: Tree): CommandResult {
  const decoder = new TextDecoder();
  let text = '';
  const write: Output = (bytes) => {
    text += bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode();
  };
  try {
    const files = module.runLLVM(argv, tree, {
      stdout: write,
      stderr: write,
      decodeASCII: false,
      synchronously: true,
      printLine: () => undefined,
    }) as Tree;
    return { code: 0, text: text + decoder.decode(), files };
  } catch (error) {
    const exit = error as { code?: unknown; files?: Tree } | null;
    if (typeof exit?.code !== 'number') throw error;
    return { code: exit.code, text: text + decoder.decode(), files: exit.files ?? null };
  }
}

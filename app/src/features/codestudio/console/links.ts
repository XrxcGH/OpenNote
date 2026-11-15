// File and line links in the console (DESIGN 5.1, MATRIX C16). Tracebacks, compiler errors, and stack traces name
// a file and a line in a few documented shapes:
// - Python's traceback: `File "main.py", line 3` (the traceback module's documented format);
// - GCC, Clang, Lua, and most compilers: `main.cpp:12:5: error` (the GNU Coding Standards' "file:line:column");
// - JavaScript stack frames: `at f (main.js:7)` or `at main.js:7:3`.
// A link is made only when the path names a file of the project, so a URL or a library path stays plain text. An
// absolute path links only inside a runtime's project folder, or by a tail that holds a folder: a library's
// `.../site-packages/pkg/utils.py` never opens the project's own `utils.py`.
//
// The search reads only the start of a long line (LINK_SEARCH_CHARS). A program can print a line of 100,000
// characters, and in each of these shapes a link sits near the start of its line.

export interface FileLink {
  /** Where the link starts and ends in the line (end exclusive). */
  start: number;
  end: number;
  /** The project path. */
  file: string;
  /** 1-based. */
  line: number;
  column?: number;
}

const PYTHON = /File "([^"\n]+)", line (\d+)/g;
// A path with an extension, then :line and an optional :column. The path may hold folders and a drive letter.
// The lookbehind starts a path only where a run of path characters starts, so each run is read once, not once
// from each of its characters.
const COLON = /(?<![\w.\-/\\])((?:[A-Za-z]:)?[\w.\-/\\]*[\w-]\.[A-Za-z0-9+]+):(\d+)(?::(\d+))?/g;

/**
 * Where runtimes put the project in their own file systems: `/project/`, and Pyodide's documented working folder
 * `/home/pyodide/`.
 */
const RUNTIME_ROOTS = ['/project/', '/home/pyodide/'];

/** How much of a line the link search reads. */
export const LINK_SEARCH_CHARS = 2000;

/** The project path that a printed path names, or null. */
export function resolvePath(printed: string, files: readonly string[]): string | null {
  // A file:// URL's path, which `//` or `///` starts once the scheme is cut, reads as one absolute path.
  let path = printed
    .replace(/\\/g, '/')
    .replace(/^file:\/\//, '')
    .replace(/^\/{2,}/, '/');
  while (path.startsWith('./')) path = path.slice(2);
  if (files.includes(path)) return path;
  // A runtime may print an absolute path inside its own file system, such as /project/src/util.py.
  const absolute = /^(\/|[A-Za-z]:\/)/.test(path);
  for (const root of RUNTIME_ROOTS) {
    if (path.startsWith(root) && files.includes(path.slice(root.length))) return path.slice(root.length);
  }
  // Outside those folders, an absolute path matches by a tail with a folder only; a bare base name may be any file.
  const tails = files.filter((file) => path.endsWith(`/${file}`) && (!absolute || file.includes('/')));
  if (tails.length > 0) return tails.reduce((best, file) => (file.length > best.length ? file : best));
  if (absolute) return null;
  const base = path.slice(path.lastIndexOf('/') + 1);
  const named = files.filter((file) => file === base || file.endsWith(`/${base}`));
  return named.length === 1 ? named[0]! : null;
}

/**
 * True when a path sits inside a URL other than file://, such as https://example.com/main.py:80: a web address,
 * not a project place. The URL is the run of text before the path up to a space, quote, or bracket.
 */
function inUrl(text: string, start: number, path: string): boolean {
  const token = (/[^\s"'(<[]*$/.exec(text.slice(Math.max(0, start - 200), start))?.[0] ?? '') + path;
  const scheme = /([A-Za-z][\w+.-]*):\/\//.exec(token);
  return scheme !== null && scheme[1]!.toLowerCase() !== 'file';
}

/** The links in one line of output, in order, none overlapping. */
export function findLinks(whole: string, files: readonly string[]): FileLink[] {
  const text = whole.length > LINK_SEARCH_CHARS ? whole.slice(0, LINK_SEARCH_CHARS) : whole;
  const links: FileLink[] = [];
  const free = (start: number, end: number) => links.every((link) => end <= link.start || start >= link.end);
  for (const match of text.matchAll(PYTHON)) {
    const file = resolvePath(match[1]!, files);
    if (!file) continue;
    links.push({ start: match.index, end: match.index + match[0].length, file, line: Number(match[2]) });
  }
  for (const match of text.matchAll(COLON)) {
    const start = match.index;
    const end = start + match[0].length;
    if (inUrl(text, start, match[1]!)) continue;
    const file = resolvePath(match[1]!, files);
    if (!file || !free(start, end)) continue;
    const link: FileLink = { start, end, file, line: Number(match[2]) };
    if (match[3]) link.column = Number(match[3]);
    links.push(link);
  }
  return links.filter((link) => link.line > 0).sort((a, b) => a.start - b.start);
}

// File and line links in the console (DESIGN 5.1, MATRIX C16). Tracebacks, compiler errors, and stack traces name
// a file and a line in a few documented shapes:
// - Python's traceback: `File "main.py", line 3` (the traceback module's documented format);
// - GCC, Clang, Lua, and most compilers: `main.cpp:12:5: error` (the GNU Coding Standards' "file:line:column");
// - JavaScript stack frames: `at f (main.js:7)` or `at main.js:7:3`.
// A link is made only when the path names a file of the project, so a URL or a library path stays plain text.

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
const COLON = /((?:[A-Za-z]:)?[\w.\-/\\]*[\w-]\.[A-Za-z0-9+]+):(\d+)(?::(\d+))?/g;

/** The project path that a printed path names, or null. */
export function resolvePath(printed: string, files: readonly string[]): string | null {
  let path = printed.replace(/\\/g, '/').replace(/^file:\/\//, '');
  while (path.startsWith('./')) path = path.slice(2);
  if (files.includes(path)) return path;
  // A runtime may print an absolute path inside its own file system, such as /project/src/util.py.
  const tails = files.filter((file) => path.endsWith(`/${file}`));
  if (tails.length > 0) return tails.reduce((best, file) => (file.length > best.length ? file : best));
  const base = path.slice(path.lastIndexOf('/') + 1);
  const named = files.filter((file) => file === base || file.endsWith(`/${base}`));
  return named.length === 1 ? named[0]! : null;
}

/** The links in one line of output, in order, none overlapping. */
export function findLinks(text: string, files: readonly string[]): FileLink[] {
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
    const file = resolvePath(match[1]!, files);
    if (!file || !free(start, end)) continue;
    const link: FileLink = { start, end, file, line: Number(match[2]) };
    if (match[3]) link.column = Number(match[3]);
    links.push(link);
  }
  return links.filter((link) => link.line > 0).sort((a, b) => a.start - b.start);
}

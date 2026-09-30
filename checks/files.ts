// Chooses which files to check, using git so results match what will be committed or pushed.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type Selection =
  { mode: 'all' } | { mode: 'staged' } | { mode: 'changed'; base: string } | { mode: 'paths'; paths: string[] };

function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function splitNul(output: string): string[] {
  return output.split('\0').filter((p) => p !== '');
}

export function repoRoot(): string {
  return git(['rev-parse', '--show-toplevel'], process.cwd()).trim();
}

export function listFiles(selection: Selection, root: string): string[] {
  switch (selection.mode) {
    case 'all':
      return splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)).filter((p) =>
        existsSync(join(root, p)),
      );
    case 'staged':
      return splitNul(git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], root));
    case 'changed':
      return changedFiles(selection.base, root);
    case 'paths':
      return expandPaths(selection.paths, root);
  }
}

/** Normalizes paths and replaces each folder with the tracked and untracked files inside it. */
function expandPaths(paths: string[], root: string): string[] {
  return paths.flatMap((raw) => {
    const path = raw.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
    const full = join(root, path);
    if (!existsSync(full) || !statSync(full).isDirectory()) return [path];
    return splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', path], root));
  });
}

/** Files that differ from the merge base with `base`, including uncommitted and untracked files. */
function changedFiles(base: string, root: string): string[] {
  let mergeBase: string;
  try {
    mergeBase = git(['merge-base', base, 'HEAD'], root).trim();
  } catch {
    throw new Error(`Can't find base "${base}". Fetch it first or pass --all.`);
  }
  const changed = splitNul(git(['diff', '--name-only', '-z', '--diff-filter=ACMR', mergeBase], root));
  const untracked = splitNul(git(['ls-files', '-z', '--others', '--exclude-standard'], root));
  return [...new Set([...changed, ...untracked])].filter((p) => existsSync(join(root, p)));
}

export function defaultBase(root: string): string {
  for (const candidate of ['origin/main', 'origin/master', 'main', 'master']) {
    try {
      git(['rev-parse', '--verify', '--quiet', candidate], root);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return 'HEAD';
}

/** Reads the staged version in staged mode, otherwise the working tree. Returns undefined for binary files. */
export function readText(path: string, root: string, staged: boolean): string | undefined {
  const buffer = staged
    ? execFileSync('git', ['show', `:${path}`], { cwd: root, maxBuffer: 64 * 1024 * 1024 })
    : readFileSync(join(root, path));
  if (buffer.subarray(0, 8000).includes(0)) return undefined;
  return buffer.toString('utf8');
}

/** All Markdown files in the repository, for cross-document checks. */
export function repoMarkdown(root: string): string[] {
  return splitNul(git(['ls-files', '-z', '--cached', '--others', '--exclude-standard', '*.md'], root));
}

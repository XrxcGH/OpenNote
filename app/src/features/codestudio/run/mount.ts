// The project inside a run worker (DESIGN 4.3): its files mounted read-only in memory, and an overlay that takes
// the program's writes. The overlay goes back to the page with the run's end, where it is shown read-only and then
// dropped, so a run never changes the project. Runtimes put this behind their own file systems (MEMFS, the WASI
// preopen, a module loader).

import { PROJECT_LIMITS } from '../contracts/project';
import type { RunFile, RunMount } from '../contracts/run';

const encoder = new TextEncoder();

/** A project path: relative, forward slashes, no empty, "." or ".." parts, within the length limit. */
export function isProjectPath(path: string): boolean {
  if (path === '' || path.length > PROJECT_LIMITS.pathChars || path.startsWith('/') || path.includes('\\')) {
    return false;
  }
  return path.split('/').every((part) => part !== '' && part !== '.' && part !== '..' && !part.includes(':'));
}

/** "./a/b.txt" and "a//b.txt" as the project path "a/b.txt"; null when it leaves the project. */
export function normalPath(path: string): string | null {
  const parts = path
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part !== '' && part !== '.');
  const normal = parts.join('/');
  return isProjectPath(normal) ? normal : null;
}

export class Mount implements RunMount {
  private files = new Map<string, string>();
  private overlay = new Map<string, string>();
  private overlayBytes = 0;

  constructor(files: readonly RunFile[]) {
    for (const file of files) this.files.set(file.path, file.text);
  }

  paths(): string[] {
    return [...new Set([...this.files.keys(), ...this.overlay.keys()])].sort();
  }

  /** The written text when there is one, else the project's. */
  read(path: string): string | null {
    const normal = normalPath(path);
    if (normal === null) return null;
    return this.overlay.get(normal) ?? this.files.get(normal) ?? null;
  }

  write(path: string, text: string): boolean {
    const normal = normalPath(path);
    if (normal === null) return false;
    const bytes = encoder.encode(text).length;
    const before = this.overlay.has(normal) ? encoder.encode(this.overlay.get(normal)!).length : 0;
    const total = this.overlayBytes - before + bytes;
    const count = this.overlay.size + (this.overlay.has(normal) ? 0 : 1);
    if (bytes > PROJECT_LIMITS.fileBytes || total > PROJECT_LIMITS.projectBytes || count > PROJECT_LIMITS.files) {
      return false;
    }
    this.overlay.set(normal, text);
    this.overlayBytes = total;
    return true;
  }

  /** What the program wrote, sorted by path, for the run's end. */
  written(): RunFile[] {
    return [...this.overlay.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, text]) => ({ path, text }));
  }
}

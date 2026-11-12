// clang's messages as RuntimeDiagnostic (DESIGN 4.6 and 6.1). clang prints one header line per message:
// "file:line:column: kind: message". The kind is error, warning, note, or fatal error. The source line and a caret
// follow it. A failed assert in a running program prints wasi-libc's form, "Assertion failed: expr (file: function:
// line)". Only project files count, so a note inside a system header (such as <stdio.h>) is left out.
//
// clang names a file the way the include reached it. '#include "../inc/shape.h"' in src/main.c is found through
// -iquote /project and named "/project/../inc/shape.h". The compiler's file system stops ".." at the project folder,
// as WASI does at a preopen, so that name is the project file "inc/shape.h", and so is "src/../inc/shape.h".

import type { DiagnosticMapper, RunFile } from '../../contracts/run';
import { patternMapper } from '../../run/diagnostics';
import { PROJECT_DIR } from './flags';

const HEADER =
  /^(?<file>[^\s:][^:\n]*):(?<line>\d+):(?<column>\d+): (?<kind>fatal error|error|warning|note): (?<message>[^\n]*)$/m;
const ASSERT = /^Assertion failed: (?<message>[^\n]*) \((?<file>[^:\n]+): [^:\n]*: (?<line>\d+)\)$/m;

const patterns = patternMapper([
  { pattern: HEADER, fallbackKind: 'error' },
  { pattern: ASSERT, fallbackKind: 'assert' },
]);

/**
 * The project path clang read for `name`: "/project/" taken off, then "." and ".." resolved, with ".." stopping at the
 * project folder. Any other absolute name (a system header) stays as it is.
 */
export function projectName(name: string): string {
  const inside = name.startsWith(`${PROJECT_DIR}/`) ? name.slice(PROJECT_DIR.length + 1) : name;
  if (inside.startsWith('/')) return name;
  const parts: string[] = [];
  for (const part of inside.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.' && part !== '') parts.push(part);
  }
  return parts.join('/');
}

/** The file name in a header line, and in an assert line after what comes before it. */
const HEADER_FILE = /^[^\s:][^:\n]*(?=:\d+:\d+: (?:fatal error|error|warning|note): )/gm;
const ASSERT_FILE = /^(Assertion failed: [^\n]* \()([^:\n]+)(?=: [^:\n]*: \d+\)$)/gm;

export const clangMapper: DiagnosticMapper = {
  map(errorText: string, files: readonly RunFile[]) {
    const text = errorText
      .replace(HEADER_FILE, (file: string) => projectName(file))
      .replace(ASSERT_FILE, (_: string, lead: string, file: string) => lead + projectName(file));
    return patterns.map(text, files);
  },
};

/** How many errors and warnings a compile reported, from clang's header lines. */
export function countOf(text: string): { errors: number; warnings: number } {
  let errors = 0;
  let warnings = 0;
  for (const match of text.matchAll(new RegExp(HEADER.source, 'gm'))) {
    const kind = match.groups?.kind;
    if (kind === 'warning') warnings += 1;
    else if (kind === 'error' || kind === 'fatal error') errors += 1;
  }
  return { errors, warnings };
}

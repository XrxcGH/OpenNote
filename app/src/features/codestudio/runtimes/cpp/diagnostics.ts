// clang's messages as RuntimeDiagnostic (DESIGN 4.6 and 6.1). clang prints one header line per message:
// "file:line:column: kind: message". The kind is error, warning, note, or fatal error. The source line and a caret
// follow it. A failed assert in a running program prints wasi-libc's form, "Assertion failed: expr (file: function:
// line)". Only project files count, so a note inside a system header (such as <stdio.h>) is left out.

import type { DiagnosticMapper } from '../../contracts/run';
import { patternMapper } from '../../run/diagnostics';

const HEADER =
  /^(?<file>[^\s:][^:\n]*):(?<line>\d+):(?<column>\d+): (?<kind>fatal error|error|warning|note): (?<message>[^\n]*)$/m;
const ASSERT = /^Assertion failed: (?<message>[^\n]*) \((?<file>[^:\n]+): [^:\n]*: (?<line>\d+)\)$/m;

export const clangMapper: DiagnosticMapper = patternMapper([
  { pattern: HEADER, fallbackKind: 'error' },
  { pattern: ASSERT, fallbackKind: 'assert' },
]);

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

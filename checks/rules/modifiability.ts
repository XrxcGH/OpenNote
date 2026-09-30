// Modifiability: code that stays easy to change. Limits file and function size, nesting and
// parameter counts, and flags untracked TODOs, commented-out code, and copy-pasted blocks.

import type { Finding, Rule, SourceFile, Threshold } from '../types.ts';
import { grade, numberSetting, threshold } from '../config.ts';
import { reporter } from './helpers.ts';
import { findFunctions } from './functions.ts';

const DEFAULTS = {
  fileLines: { warn: 400, error: 800 },
  functionLines: { warn: 50, error: 100 },
  nestingDepth: { warn: 4, error: 6 },
  parameters: { warn: 5, error: 8 },
};

export const modifiability: Rule = {
  id: 'modifiability',
  description:
    'File and function size, nesting depth, parameter count, TODO tracking, commented-out and duplicated code.',
  appliesTo: (file) =>
    file.kind === 'code' && !['css', 'scss', 'html', 'xml', 'yml', 'yaml', 'toml'].includes(file.ext),
  check(file, ctx) {
    const limit = (key: keyof typeof DEFAULTS) => threshold(ctx.settings, key, DEFAULTS[key]);
    const report = reporter('modifiability', file);
    const findings: Finding[] = [];
    const lineCount = file.lines.length;
    const fileSeverity = grade(lineCount, limit('fileLines'));
    if (fileSeverity)
      findings.push(
        report(
          1,
          `File has ${lineCount} lines (limit ${limit('fileLines').warn}). Split it into modules.`,
          fileSeverity,
        ),
      );
    findings.push(...functionFindings(file, limit('functionLines'), limit('nestingDepth'), limit('parameters')));
    findings.push(...todoFindings(file), ...commentedCodeFindings(file));
    findings.push(...duplicateFindings(file, numberSetting(ctx.settings, 'duplicateBlockLines', 8)));
    return findings;
  },
};

function functionFindings(file: SourceFile, lines: Threshold, depth: Threshold, params: Threshold): Finding[] {
  const report = reporter('modifiability', file);
  const findings: Finding[] = [];
  for (const fn of findFunctions(file)) {
    const length = fn.end - fn.start + 1;
    const checks: [number, Threshold, string][] = [
      [length, lines, `Function "${fn.name}" is ${length} lines (limit ${lines.warn}). Extract smaller functions.`],
      [
        fn.maxDepth,
        depth,
        `Function "${fn.name}" nests ${fn.maxDepth} levels (limit ${depth.warn}). Return early or extract helpers.`,
      ],
      [
        fn.parameters,
        params,
        `Function "${fn.name}" takes ${fn.parameters} parameters (limit ${params.warn}). Pass an options object.`,
      ],
    ];
    for (const [value, limit, message] of checks) {
      const severity = grade(value, limit);
      if (severity) findings.push(report(fn.start, message, severity));
    }
  }
  return findings;
}

function todoFindings(file: SourceFile): Finding[] {
  const report = reporter('modifiability', file);
  return file
    .prose()
    .filter((p) => /\b(TODO|FIXME|XXX|HACK)\b/.test(p.text) && !/#\d+|https?:|\b[A-Z]+-\d+\b/.test(p.raw))
    .map((p) =>
      report(p.line, 'TODO without an issue link. Add one, e.g. "TODO(#42): …", so it is tracked.', 'warning'),
    );
}

const CODE_LIKE =
  /([;{}]\s*$)|^(const|let|var|if|for|while|return|import|export|fn|def|class|function|await)\b|^\w+(\.\w+)*\(.*\);?$/;

function commentedCodeFindings(file: SourceFile): Finding[] {
  const report = reporter('modifiability', file);
  const findings: Finding[] = [];
  let runStart = -1;
  let runLength = 0;
  let previous = -1;
  for (const prose of file.prose()) {
    const codeLike = CODE_LIKE.test(prose.text);
    const continues = codeLike && prose.line === previous + 1 && runLength > 0;
    if (continues) runLength += 1;
    else if (codeLike) [runStart, runLength] = [prose.line, 1];
    else runLength = 0;
    if (runLength === 3)
      findings.push(report(runStart, 'Commented-out code. Delete it; version control keeps history.', 'warning'));
    previous = prose.line;
  }
  return findings;
}

function duplicateFindings(file: SourceFile, windowSize: number): Finding[] {
  const report = reporter('modifiability', file);
  const meaningful = file
    .codeOnly()
    .map((text, i) => ({ line: i + 1, text: text.trim().replace(/\s+/g, ' ') }))
    .filter((l) => l.text.length > 3 && !/^[\s{}()[\];,]*$/.test(l.text));
  const seen = new Map<string, number>();
  const findings: Finding[] = [];
  for (let i = 0; i + windowSize <= meaningful.length; i++) {
    const key = meaningful
      .slice(i, i + windowSize)
      .map((l) => l.text)
      .join('\n');
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, i);
    } else if (i - first >= windowSize) {
      findings.push(
        report(
          meaningful[i].line,
          `Duplicates ${windowSize}+ lines from line ${meaningful[first].line}. Extract a shared function.`,
          'warning',
        ),
      );
      i += windowSize - 1;
    }
  }
  return findings;
}

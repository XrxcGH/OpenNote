// Interface text follows BRAND.md's voice (ARCHITECTURE.md section 19.4). For each string in app/src/strings/en/,
// it checks sentence case, no exclamation marks, no "Oops", no emoji, digits for numbers, and shortcuts written
// as Ctrl+Shift+D. The spelling, grammar, and AI marker rules also run on each value.
// ICU messages are checked branch by branch, with each placeholder read as a name.

import type { Finding, Rule, RuleContext, SourceFile } from '../types.ts';
import { stringList } from '../config.ts';
import { matchesAny } from '../glob.ts';
import { createSourceFile } from '../source.ts';
import { caseProblem } from '../text.ts';
import { aiMarkers } from './ai-markers.ts';
import { grammar } from './grammar.ts';
import { reporter } from './helpers.ts';
import { spelling } from './spelling.ts';

const DEFAULT_INCLUDE = ['app/src/strings/en/**/*.ts'];
const STRING = /'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;
const SKIPPED_LINE = /^\s*(\/\/|\/\*|\*|import\b|export\s+\*)|\bfrom\s+['"]/;
const BLOCK = /^\{\s*\w+\s*,\s*(?:plural|select)\s*,/;
const NUMBER_WORDS = /\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i;
const CHORD = /\b(?:Ctrl|Control|CTRL|Alt|Shift)\s*[+-]\s*[\w+=/,.-]*/g;
const SHORTCUT_PROBLEMS = [
  /\b(?:Control|CONTROL|CTRL|ctrl|Ctl|CTL)\s*\+/,
  /\b(?:Ctrl|Alt|Shift)\s*-\s*[A-Z0-9]/,
  /\b(?:Ctrl|Alt|Shift)(?:\s+\+|\+\s)/,
];

export const uiVoice: Rule = {
  id: 'ui-voice',
  description: 'Interface strings follow the BRAND.md voice: sentence case, no exclamation marks, no emoji.',
  appliesTo: (file) => file.ext === 'ts',
  async check(file, ctx) {
    const include = stringList(ctx.settings, 'include');
    if (!matchesAny(file.path, include.length ? include : DEFAULT_INCLUDE)) return [];
    const values = file.lines.map((raw) => (SKIPPED_LINE.test(raw) ? [] : stringValues(raw).flatMap(variants)));
    const findings = values.flatMap((texts, i) => texts.flatMap((text) => voiceFindings(file, i + 1, text)));
    return [...findings, ...(await proseFindings(file, ctx, values))];
  },
};

function stringValues(raw: string): string[] {
  return [...raw.matchAll(STRING)].map((match) => (match[1] ?? match[2] ?? match[3]).replace(/\\(.)/g, '$1'));
}

/** Finds the first top-level {name, plural|select, ...} block and its branch texts. */
function firstBlock(message: string): { start: number; end: number; branches: string[] } | null {
  for (let start = message.indexOf('{'); start !== -1; start = message.indexOf('{', start + 1)) {
    const end = closing(message, start);
    if (end === -1) return null;
    const inner = message.slice(start, end + 1);
    const head = BLOCK.exec(inner);
    if (head) return { start, end: end + 1, branches: branches(inner.slice(head[0].length, -1)) };
    start = end;
  }
  return null;
}

/** The index of the brace that closes the one at `open`, or -1. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    if (text[i] === '}' && --depth === 0) return i;
  }
  return -1;
}

/** The texts of branches such as `one {# page} other {# pages}`. */
function branches(body: string): string[] {
  const texts: string[] = [];
  for (let i = body.indexOf('{'); i !== -1; i = body.indexOf('{', i + 1)) {
    const end = closing(body, i);
    if (end === -1) break;
    texts.push(body.slice(i + 1, end));
    i = end;
  }
  return texts;
}

/** Each readable version of an ICU message, with placeholders as "Biology" and # as 3. */
export function variants(message: string, depth = 0): string[] {
  const block = depth < 4 ? firstBlock(message) : null;
  if (!block) return [message.replace(/\{[^{}]*\}/g, 'Biology').replace(/#/g, '3')];
  const [before, after] = [message.slice(0, block.start), message.slice(block.end)];
  return block.branches.flatMap((branch) => variants(before + branch + after, depth + 1));
}

function voiceFindings(file: SourceFile, line: number, text: string): Finding[] {
  const report = reporter('ui-voice', file);
  const findings: Finding[] = [];
  const quote = `"${text.slice(0, 40)}"`;
  if (text.includes('!')) findings.push(report(line, `No exclamation marks in interface text: ${quote}.`));
  if (/\boops\b/i.test(text)) findings.push(report(line, `Say what happened instead of "Oops": ${quote}.`));
  if (/\p{Extended_Pictographic}/u.test(text)) findings.push(report(line, `No emoji in interface text: ${quote}.`));
  // Key names are capitalized, so shortcuts such as Ctrl+Shift+D don't count toward Title Case.
  const caseMessage = caseProblem(text.replace(CHORD, ''));
  if (caseMessage) findings.push(report(line, caseMessage));
  if (NUMBER_WORDS.test(text)) findings.push(report(line, `Write numbers as digits ("3 pages"): ${quote}.`, 'warning'));
  if (SHORTCUT_PROBLEMS.some((pattern) => pattern.test(text)))
    findings.push(report(line, `Write shortcuts as Ctrl+Shift+D: ${quote}.`));
  return findings;
}

/** Runs the spelling, grammar, and AI marker rules on the string values, line for line. */
async function proseFindings(file: SourceFile, ctx: RuleContext, values: string[][]): Promise<Finding[]> {
  const text = values.map((texts) => texts.join(' ')).join('\n');
  const strings = createSourceFile(file.path.replace(/\.ts$/, '.txt'), text);
  const results = await Promise.all(
    [spelling, grammar, aiMarkers].map((rule) =>
      rule.check(strings, { ...ctx, settings: ctx.config.rules[rule.id] ?? {} }),
    ),
  );
  return results.flat().map((finding) => ({ ...finding, rule: 'ui-voice', file: file.path }));
}

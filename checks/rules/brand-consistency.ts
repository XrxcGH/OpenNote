// Brand consistency in UI code. Colors, fonts, motion, and layering must come from design tokens
// (see BRAND.md and brand/tokens.json). That way the look can change in one place later.

import type { Finding, Rule, SourceFile } from '../types.ts';
import { numberSetting, stringList } from '../config.ts';
import { matchesAny } from '../glob.ts';
import { reporter } from './helpers.ts';

const DEFAULT_INCLUDE = ['app/src/**/*.{ts,tsx,css,scss}'];
const DEFAULT_TOKEN_FILES = ['app/src/theme/**', 'brand/**'];
const RAW_COLOR = /(^|[\s:'"`(,=])(#[0-9a-fA-F]{3,8}\b|(?:rgba?|hsla?|oklch|oklab|lab|lch)\()/;
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

export const brandConsistency: Rule = {
  id: 'brand-consistency',
  description: 'UI code must use design tokens for colors, fonts, durations, z-index and font sizes.',
  appliesTo: () => true,
  check(file, ctx) {
    const include = stringList(ctx.settings, 'include');
    const tokenFiles = stringList(ctx.settings, 'tokenFiles');
    if (!matchesAny(file.path, include.length ? include : DEFAULT_INCLUDE)) return [];
    if (matchesAny(file.path, tokenFiles.length ? tokenFiles : DEFAULT_TOKEN_FILES)) return [];
    const maxMs = numberSetting(ctx.settings, 'maxDurationMs', 400);
    const findings: Finding[] = [];
    file.lines.forEach((raw, i) => {
      if (!COMMENT_LINE.test(raw)) findings.push(...checkLine(file, raw, i + 1, maxMs));
    });
    return findings;
  },
};

function checkLine(file: SourceFile, raw: string, line: number, maxMs: number): Finding[] {
  const report = reporter('brand-consistency', file);
  const findings: Finding[] = [];
  if (RAW_COLOR.test(raw)) findings.push(report(line, 'Raw color value. Use a color token from brand/tokens.json.'));
  if (/font-?family\s*:\s*(?!\s*var\()/i.test(raw)) findings.push(report(line, 'Raw font family. Use a font token.'));
  if (/z-?index\s*:\s*['"]?-?\d+/i.test(raw)) findings.push(report(line, 'Raw z-index. Use a layer token.', 'warning'));
  if (/font-?size\s*:\s*['"]?\d+(\.\d+)?(px)?['"]?\s*[,;}]?/i.test(raw) && !/var\(/.test(raw)) {
    findings.push(report(line, 'Raw font size. Use a type-scale token.', 'warning'));
  }
  findings.push(...durationFindings(file, raw, line, maxMs));
  return findings;
}

function durationFindings(file: SourceFile, raw: string, line: number, maxMs: number): Finding[] {
  if (!/(transition|animation|duration|delay)/i.test(raw)) return [];
  const report = reporter('brand-consistency', file);
  const findings: Finding[] = [];
  for (const match of raw.matchAll(/\b(\d+(?:\.\d+)?)(ms|s)\b/g)) {
    const ms = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
    if (ms > maxMs) findings.push(report(line, `${match[0]} is slower than the ${maxMs}ms motion limit in BRAND.md.`));
    else findings.push(report(line, `Raw duration ${match[0]}. Use a motion token.`, 'warning'));
  }
  return findings;
}

// Ease of use. Documents need a clear structure, working links, and a table of contents when long.
// UI code needs the basics that keep the app usable with a keyboard or screen reader.

import { posix } from 'node:path';
import type { Finding, ProseLine, Rule, RuleContext, SourceFile } from '../types.ts';
import { numberSetting } from '../config.ts';
import { caseProblem, wordCount } from '../text.ts';
import { reporter } from './helpers.ts';

const UI_EXTENSIONS = ['tsx', 'jsx', 'html', 'vue', 'svelte', 'css', 'scss'];

export const usability: Rule = {
  id: 'usability',
  description: 'Document structure, links, image text and basic UI accessibility.',
  appliesTo: (file) => file.kind === 'markdown' || UI_EXTENSIONS.includes(file.ext),
  check(file, ctx) {
    if (file.kind !== 'markdown') return uiFindings(file);
    return [...headingFindings(file), ...tocFindings(file, ctx), ...linkFindings(file, ctx)];
  },
};

function headingFindings(file: SourceFile): Finding[] {
  const report = reporter('usability', file);
  const headings = file.prose().filter((p) => p.context === 'heading');
  const first = file.prose()[0];
  const findings: Finding[] = [];
  if (!first || first.headingLevel !== 1)
    findings.push(report(first?.line ?? 1, 'Start the document with a single "# Title" heading.'));
  let previous = 0;
  for (const heading of headings) {
    const level = heading.headingLevel ?? 1;
    if (level === 1 && heading !== first)
      findings.push(report(heading.line, 'Only one top-level "#" heading per document.'));
    if (previous > 0 && level > previous + 1)
      findings.push(report(heading.line, `Heading jumps from level ${previous} to ${level}. Don't skip levels.`));
    if (wordCount(heading.text) > 12)
      findings.push(report(heading.line, 'Heading is longer than 12 words.', 'warning'));
    const caseMessage = caseProblem(heading.text);
    if (caseMessage) findings.push(report(heading.line, caseMessage, 'warning'));
    previous = level;
  }
  return findings;
}

function tocFindings(file: SourceFile, ctx: RuleContext): Finding[] {
  const minWords = numberSetting(ctx.settings, 'tocMinWords', 1500);
  const words = file
    .blocks()
    .filter((b) => b.context !== 'table')
    .reduce((sum, b) => sum + wordCount(b.text), 0);
  if (words < minWords) return [];
  const tocLinks = file.lines.slice(0, 80).filter((l) => /\]\(#[^)]+\)/.test(l)).length;
  if (tocLinks >= 3) return [];
  return [reporter('usability', file)(1, `Document has ${words} words. Add a table of contents near the top.`)];
}

function linkFindings(file: SourceFile, ctx: RuleContext): Finding[] {
  const report = reporter('usability', file);
  const findings: Finding[] = [];
  const ownSlugs = headingSlugs(file.prose());
  for (const prose of file.prose()) {
    const raw = prose.raw.replace(/`[^`]*`/g, '');
    for (const match of raw.matchAll(/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const [, bang, label, target] = match;
      if (bang && label.trim() === '') findings.push(report(prose.line, 'Image needs alt text describing it.'));
      const problem = checkTarget(file.path, target, ownSlugs, ctx);
      if (problem) findings.push(report(prose.line, problem));
    }
  }
  return findings;
}

function checkTarget(fromPath: string, target: string, ownSlugs: Set<string>, ctx: RuleContext): string | undefined {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('//')) return undefined;
  const [pathPart, anchor] = target.split('#');
  const resolved = pathPart ? posix.normalize(posix.join(posix.dirname(fromPath), decodeURI(pathPart))) : fromPath;
  if (pathPart && !ctx.fileExists(resolved)) return `Broken link: "${target}" does not exist.`;
  if (!anchor) return undefined;
  const slugs = pathPart ? slugsOf(resolved, ctx) : ownSlugs;
  if (slugs && !slugs.has(anchor)) return `Broken link: no heading "#${anchor}" in ${resolved}.`;
  return undefined;
}

function slugsOf(path: string, ctx: RuleContext): Set<string> | undefined {
  if (!path.endsWith('.md')) return undefined;
  const text = ctx.readRepoFile(path);
  if (text === undefined) return undefined;
  const headings = text.split('\n').flatMap((raw, i): ProseLine[] => {
    const m = /^(#{1,6})\s+(.*)$/.exec(raw);
    return m ? [{ line: i + 1, raw, text: m[2], context: 'heading', headingLevel: m[1].length }] : [];
  });
  return headingSlugs(headings);
}

/** GitHub-style heading anchors, including the -1, -2 suffixes for repeated headings. */
export function headingSlugs(prose: ProseLine[]): Set<string> {
  const slugs = new Set<string>();
  const counts = new Map<string, number>();
  for (const heading of prose.filter((p) => p.context === 'heading')) {
    const text = heading.raw.replace(/^#{1,6}\s+/, '');
    const base = githubSlug(text);
    const seen = counts.get(base) ?? 0;
    slugs.add(seen === 0 ? base : `${base}-${seen}`);
    counts.set(base, seen + 1);
  }
  return slugs;
}

export function githubSlug(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/ /g, '-');
}

function uiFindings(file: SourceFile): Finding[] {
  const report = reporter('usability', file);
  const findings: Finding[] = [];
  const text = file.lines.join('\n');
  for (const match of text.matchAll(/<img\b[^>]*>/g)) {
    if (!/\balt=/.test(match[0]))
      findings.push(report(lineAt(text, match.index), 'Image needs an alt attribute (alt="" if decorative).'));
  }
  file.lines.forEach((raw, i) => {
    if (/<(div|span)\b[^>]*onClick/.test(raw) && !/\brole=/.test(raw))
      findings.push(report(i + 1, 'Clickable div/span needs a role and keyboard support. Prefer <button>.', 'warning'));
    if (/tabIndex=\{?["']?[1-9]/.test(raw))
      findings.push(report(i + 1, 'Positive tabIndex breaks keyboard order. Use 0 or -1.', 'warning'));
    if (/outline\s*:\s*(none|0)\b/.test(raw))
      findings.push(
        report(i + 1, 'Removing the outline hides keyboard focus. Use the focus-ring token instead.', 'warning'),
      );
  });
  return findings;
}

function lineAt(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

// Writes the release notes. People read what is in CHANGELOG.md for the version, and the merge commits since the
// previous release give the full list of changes. The same text feeds the GitHub Release page (Markdown) and the
// update notice in the app (plain text, at most 8 lines, because that is all the notice shows).
// Usage: node app/scripts/release/notes.ts <tag> [--prev <tag>] [--ref <ref>] [--changelog <file>]
//          [--markdown <file>] [--plain <file>]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO, RELEASE_FILES, versionOf } from '../write-manifest.ts';
import { compareVersions } from './versions.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

/** The update notice shows at most this many lines of notes. */
export const MAX_PLAIN_LINES = 8;
export const MAX_PLAIN_BYTES = 4096;

/** What each download is for, in the words people see on the release page. */
const FILE_LABELS: Record<string, string> = {
  'OpenNote_Windows64.exe': '64-bit Windows, on most PCs',
  'OpenNote_Windows32.exe': '32-bit Windows',
  'OpenNote_WindowsARM64.exe': 'Windows on Arm, such as Snapdragon laptops',
};

export interface Change {
  sha: string;
  /** What changed, as one sentence-case line. */
  text: string;
  pr?: number;
}

/** The part of CHANGELOG.md under `## [version]`, up to the next `## ` heading. Undefined when there is none. */
export function changelogSection(changelog: string, version: string): string | undefined {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^## \\[?${escaped}\\]?(?:\\s.*)?$`, 'm').exec(changelog);
  if (!heading) return undefined;
  const rest = changelog.slice(heading.index + heading[0].length);
  const next = /^## /m.exec(rest);
  const body = (next ? rest.slice(0, next.index) : rest).replace(/^\[[^\]]+\]: .*$/gm, '').trim();
  return body === '' ? undefined : body;
}

/** A line of release notes with its Markdown removed: links keep their words, and emphasis marks go. */
export function plainLine(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/^\s*[-*+]\s+/, '')
    .trim();
}

/** The bullet lines of a changelog section as plain sentences, without headings or blank lines. */
export function bulletsOf(section: string): string[] {
  return section
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*+]\s+\S/.test(line))
    .map(plainLine);
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * One merge commit as a change, or undefined for a merge that only brings a branch up to date. It reads GitHub's
 * `Merge pull request #12 from owner/branch` (the title is in the body), and `Merge phase-2: app shell`.
 */
export function changeFromMerge(sha: string, subject: string, body: string): Change | undefined {
  const pull = /^Merge pull request #(\d+) from \S+/.exec(subject);
  if (pull) {
    const title = body.split(/\r?\n/).find((line) => line.trim() !== '');
    return { sha, pr: Number(pull[1]), text: capitalized(title?.trim() ?? subject) };
  }
  if (/^Merge (branch|remote-tracking branch|tag) /.test(subject) || /^Merge \S+ into \S+$/.test(subject)) {
    return undefined;
  }
  const named = /^Merge [\w./-]+: (.+)$/.exec(subject);
  return { sha, text: capitalized(named ? named[1] : subject.replace(/^Merge /, '')) };
}

/** Parses `git log --format=%H%x1f%s%x1f%b%x1e` output into changes, newest first. */
export function parseLog(log: string, merges: boolean): Change[] {
  const changes: Change[] = [];
  for (const record of log.split('\x1e')) {
    const [sha, subject, body] = record.replace(/^\s+/, '').split('\x1f');
    if (!sha || subject === undefined) continue;
    const change = merges ? changeFromMerge(sha, subject, body ?? '') : { sha, text: capitalized(subject) };
    if (change) changes.push(change);
  }
  return changes;
}

/** The newest tag that is older than `tag`. A stable release looks back to the previous stable one. */
export function previousTag(tags: readonly string[], tag: string): string | undefined {
  const stable = !versionOf(tag).includes('-');
  const older = tags.filter((other) => other !== tag && compareVersions(versionOf(other), versionOf(tag)) < 0);
  const candidates = stable ? older.filter((other) => !versionOf(other).includes('-')) : older;
  return candidates.sort((a, b) => compareVersions(versionOf(b), versionOf(a)))[0];
}

export interface NotesInput {
  tag: string;
  changelog?: string;
  changes: readonly Change[];
  previous?: string;
}

function downloads(): string {
  const rows = RELEASE_FILES.map(({ file }) => `| ${FILE_LABELS[file] ?? file} | \`${file}\` |`);
  return ['| For | Download |', '| --- | --- |', ...rows].join('\n');
}

function changeLine(change: Change): string {
  const link = change.pr ? ` ([#${change.pr}](https://github.com/${REPO}/pull/${change.pr}))` : '';
  // A commit subject is plain text, but a < in it would start an HTML tag on the release page and hide the words.
  const text = change.text.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `- ${text}${link}`;
}

/** The release page: what is new, which file to download, and every change since the last release. */
export function markdownNotes({ tag, changelog, changes, previous }: NotesInput): string {
  const section = changelog === undefined ? undefined : changelogSection(changelog, versionOf(tag));
  const parts = [section ? `## What's new\n\n${section}` : `## OpenNote ${versionOf(tag)}`];
  parts.push(`## Download\n\nChoose the file for your PC. After that, the app updates itself.\n\n${downloads()}`);
  if (changes.length > 0) {
    const list = changes.map(changeLine).join('\n');
    parts.push(`<details>\n<summary>All changes (${changes.length})</summary>\n\n${list}\n\n</details>`);
  }
  if (previous) {
    parts.push(`Full list of commits: https://github.com/${REPO}/compare/${previous}...${tag}`);
  }
  return `${parts.join('\n\n')}\n`;
}

/** The notes for the update notice in the app: plain sentences, one per line, within what the notice can show. */
export function plainNotes({ tag, changelog, changes }: NotesInput): string {
  const section = changelog === undefined ? undefined : changelogSection(changelog, versionOf(tag));
  const items = section ? bulletsOf(section) : changes.map((change) => change.text);
  if (items.length === 0) return `OpenNote ${tag}`;
  const link = `Full notes: https://github.com/${REPO}/releases/tag/${tag}`;
  const lines =
    items.length <= MAX_PLAIN_LINES
      ? items
      : [...items.slice(0, MAX_PLAIN_LINES - 2), `And ${items.length - (MAX_PLAIN_LINES - 2)} more.`, link];
  const text = lines.join('\n');
  return Buffer.byteLength(text) <= MAX_PLAIN_BYTES ? text : `OpenNote ${tag}\n${link}`;
}

function git(args: string[], cwd: string = ROOT): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** The changes between two refs: its merge commits on the main line, or its plain commits when there are none. */
export function changesBetween(previous: string | undefined, ref: string, cwd: string = ROOT): Change[] {
  const range = previous ? `${previous}..${ref}` : ref;
  const format = '--format=%H%x1f%s%x1f%b%x1e';
  const merges = parseLog(git(['log', '--first-parent', '--merges', format, range], cwd), true);
  if (merges.length > 0) return merges;
  return parseLog(git(['log', '--first-parent', '--no-merges', format, range], cwd), false);
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function main(): void {
  const args = process.argv.slice(2);
  const tag = args[0];
  if (!tag || tag.startsWith('--'))
    throw new Error('Usage: node app/scripts/release/notes.ts <tag> [--prev <tag>] [--ref <ref>]');
  const ref = option(args, '--ref') ?? 'HEAD';
  const previous =
    option(args, '--prev') ?? previousTag(git(['tag', '--list', 'v*']).split(/\s+/).filter(Boolean), tag);
  const changelogPath = option(args, '--changelog') ?? join(ROOT, 'CHANGELOG.md');
  const input: NotesInput = {
    tag,
    changelog: readFileSync(changelogPath, 'utf8'),
    changes: changesBetween(previous, ref),
    previous,
  };
  writeFileSync(option(args, '--markdown') ?? 'release-notes.md', markdownNotes(input));
  writeFileSync(option(args, '--plain') ?? 'release-notes.txt', `${plainNotes(input)}\n`);
  console.log(`Wrote release notes for ${tag}: ${input.changes.length} changes since ${previous ?? 'the start'}.`);
}

if (import.meta.main) main();

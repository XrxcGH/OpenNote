// Checks the interface bundle against its budget (ARCHITECTURE.md section 20.3). It reads Vite's build manifest,
// gzips each group of files, and fails when a group passes its limit in app/bundle-budget.json. The groups are:
// - start-up JavaScript: the entry and everything it imports statically
// - start-up CSS: the style sheets of those chunks
// - one lazy group per dynamic import, without what start-up already loads. A group that only ever loads after
//   another one (the page's on-demand chunks load after the page) also leaves out what that one loads.
//
// Run after `npm run app:build`:
//   node app/scripts/check-bundle.ts [--dist app/dist] [--compare-with <old report.json>] [--report <out.json>]
// The job summary shows each group's size and its change from the report it compares with.

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';

export interface ManifestChunk {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
  css?: string[];
}
export type Manifest = Record<string, ManifestChunk>;

export interface Budget {
  startup: { jsKb: number; cssKb: number };
  /** Limits for lazy groups whose source path contains the key, such as "features/palette". */
  lazyKb: Record<string, number>;
  lazyDefaultKb: number;
  /**
   * Lazy groups that load only after another one: a group whose source path contains `within` counts without the
   * files of the group whose path contains `entry`, which is loaded by then.
   */
  after?: { within: string; entry: string };
}

export interface Group {
  name: string;
  files: string[];
  limitKb: number;
}

export interface Measured extends Group {
  bytes: number;
}

/** Every chunk that `keys` load statically, including themselves. */
function staticClosure(manifest: Manifest, keys: readonly string[]): Set<string> {
  const seen = new Set<string>();
  const visit = (key: string) => {
    if (seen.has(key) || !manifest[key]) return;
    seen.add(key);
    manifest[key].imports?.forEach(visit);
  };
  keys.forEach(visit);
  return seen;
}

export function groups(manifest: Manifest, budget: Budget): Group[] {
  const keys = Object.keys(manifest);
  const startup = staticClosure(
    manifest,
    keys.filter((key) => manifest[key].isEntry),
  );
  const startupChunks = [...startup].map((key) => manifest[key]);
  const result: Group[] = [
    { name: 'start-up JavaScript', files: startupChunks.map((chunk) => chunk.file), limitKb: budget.startup.jsKb },
    {
      name: 'start-up CSS',
      files: [...new Set(startupChunks.flatMap((c) => c.css ?? []))],
      limitKb: budget.startup.cssKb,
    },
  ];
  const lazyKeys = keys.filter((k) => manifest[k].isDynamicEntry);
  const first = budget.after && lazyKeys.find((k) => k.includes(budget.after!.entry));
  const loadedFirst = first ? staticClosure(manifest, [first]) : new Set<string>();
  for (const key of lazyKeys) {
    const follows = first !== undefined && key !== first && key.includes(budget.after!.within);
    const loaded = (k: string) => startup.has(k) || (follows && loadedFirst.has(k));
    const own = [...staticClosure(manifest, [key])].filter((k) => !loaded(k)).map((k) => manifest[k]);
    const limit = Object.entries(budget.lazyKb).find(([fragment]) => key.includes(fragment))?.[1];
    const files = [...own.map((chunk) => chunk.file), ...new Set(own.flatMap((chunk) => chunk.css ?? []))];
    result.push({ name: manifest[key].src ?? key, files, limitKb: limit ?? budget.lazyDefaultKb });
  }
  return result;
}

export function measure(dist: string, group: Group): Measured {
  const bytes = group.files.reduce(
    (sum, file) => sum + gzipSync(readFileSync(join(dist, file)), { level: 9 }).length,
    0,
  );
  return { ...group, bytes };
}

export function failures(measured: readonly Measured[]): string[] {
  return measured
    .filter((group) => group.bytes > group.limitKb * 1024)
    .map((group) => `${group.name} is ${kb(group.bytes)} KB gzipped; its limit is ${group.limitKb} KB.`);
}

const kb = (bytes: number) => (bytes / 1024).toFixed(1);

export function summary(measured: readonly Measured[], baseline: readonly Measured[] | null): string {
  const rows = measured.map((group) => {
    const before = baseline?.find((old) => old.name === group.name);
    const change = before ? `${group.bytes >= before.bytes ? '+' : ''}${kb(group.bytes - before.bytes)}` : 'new';
    return `| ${group.name} | ${kb(group.bytes)} | ${group.limitKb} | ${baseline ? change : 'no baseline'} |`;
  });
  return ['| Group | KB gzipped | Limit (KB) | Change from main (KB) |', '|---|---|---|---|', ...rows].join('\n');
}

function main(): void {
  const { values } = parseArgs({
    options: {
      dist: { type: 'string', default: join(import.meta.dirname, '..', 'dist') },
      budget: { type: 'string', default: join(import.meta.dirname, '..', 'bundle-budget.json') },
      'compare-with': { type: 'string' },
      report: { type: 'string' },
    },
  });
  const dist = values.dist;
  const manifest = JSON.parse(readFileSync(join(dist, '.vite', 'manifest.json'), 'utf8')) as Manifest;
  const budget = JSON.parse(readFileSync(values.budget, 'utf8')) as Budget;
  const measured = groups(manifest, budget).map((group) => measure(dist, group));
  const compare = values['compare-with'];
  const baseline = compare && existsSync(compare) ? (JSON.parse(readFileSync(compare, 'utf8')) as Measured[]) : null;
  const table = summary(measured, baseline);
  console.log(table);
  writeFileSync(values.report ?? join(dist, 'bundle-report.json'), `${JSON.stringify(measured, null, 2)}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Bundle sizes\n\n${table}\n`);
  const failed = failures(measured);
  failed.forEach((message) => console.error(message));
  process.exitCode = failed.length ? 1 : 0;
}

if (import.meta.main) main();

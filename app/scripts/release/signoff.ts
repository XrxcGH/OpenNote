// Records one person's sign-off of a release checklist item in docs/releases/<version>.signoff.json, creating the
// file from the blank template when it is missing. It checks the entry the way checklist.ts will, so a sign-off
// that would not count is refused here, with the reason. The update-from-earlier-beta test can add its report to
// the notes of the `updates` item, but a person still signs it.
//
// Usage: node app/scripts/release/signoff.ts <version> <item> --by <name> [--date YYYY-MM-DD] [--notes <text>]
//                                             [--device <type>=<name>]... [--update-report <file>]
// Items: budgets, accessibility, pen, upgrade, format, updates, docs.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { deviceTypes, readPlan } from './checklist-doc.ts';
import {
  entryProblem,
  MANUAL_ITEMS,
  readSignoff,
  signoffPath,
  signoffTemplate,
  type Device,
  type Entry,
  type ManualItem,
  type Signoff,
} from './checklist-signoff.ts';

const ROOT = join(import.meta.dirname, '..', '..', '..');

export interface SignoffInput {
  version: string;
  item: string;
  by: string;
  date: string;
  notes?: string;
  devices?: Device[];
  /** The JSON report of update-test.ts, added to the notes. */
  updateReport?: { from: string; to: string; ok: boolean; detail: string };
}

/** Today in UTC as YYYY-MM-DD. */
export const today = (): string => new Date().toISOString().slice(0, 10);

/** Reads `type=name` device arguments. */
export function parseDevice(text: string): Device {
  const at = text.indexOf('=');
  if (at <= 0 || at === text.length - 1) throw new Error(`"${text}" is not a device in the form <type>=<name>.`);
  return { type: text.slice(0, at).trim(), name: text.slice(at + 1).trim() };
}

/** The sign-off with the new entry in it, or an error that says why the entry would not count. */
export function withEntry(current: Signoff, input: SignoffInput, now: string, types: readonly string[]): Signoff {
  if (!MANUAL_ITEMS.includes(input.item as ManualItem)) {
    throw new Error(`"${input.item}" is not a checklist item a person signs. Use one of: ${MANUAL_ITEMS.join(', ')}.`);
  }
  if (current.version !== input.version) {
    throw new Error(`The sign-off file is for ${current.version}, not ${input.version}.`);
  }
  const item = input.item as ManualItem;
  const report = input.updateReport;
  if (report && !report.ok) throw new Error(`The update test did not pass: ${report.detail}`);
  const notes = [input.notes?.trim(), report ? `Update test: ${report.detail}` : undefined].filter(Boolean).join(' ');
  const entry: Entry = { by: input.by.trim(), date: input.date, ...(notes ? { notes } : {}) };
  if (input.devices?.length) entry.devices = input.devices;
  const problem = entryProblem(item, entry, now, types);
  if (problem) throw new Error(problem);
  return { ...current, items: { ...current.items, [item]: entry } };
}

/** Writes the entry to the version's sign-off file and returns its path. */
export function recordSignoff(root: string, input: SignoffInput, types: readonly string[], now = today()): string {
  const path = signoffPath(input.version);
  const file = join(root, path);
  const current = existsSync(file) ? readSignoff(root, input.version) : signoffTemplate(input.version);
  const next = withEntry(current, input, now, types);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
  return path;
}

function option(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at === -1 ? undefined : args[at + 1];
}

function main(): void {
  const args = process.argv.slice(2);
  const [version, item] = args;
  const by = option(args, '--by');
  if (!version || !item || !by) {
    throw new Error('Usage: node app/scripts/release/signoff.ts <version> <item> --by <name> [--date YYYY-MM-DD]');
  }
  const devices = args.flatMap((arg, at) => (args[at - 1] === '--device' ? [parseDevice(arg)] : []));
  const reportFile = option(args, '--update-report');
  const input: SignoffInput = {
    version,
    item,
    by,
    date: option(args, '--date') ?? today(),
    notes: option(args, '--notes'),
    devices,
    updateReport: reportFile ? JSON.parse(readFileSync(reportFile, 'utf8')) : undefined,
  };
  const path = recordSignoff(ROOT, input, deviceTypes(readPlan(ROOT)));
  console.log(`Recorded ${item} for ${version} in ${path}. Commit it before you tag the release.`);
}

if (import.meta.main) main();

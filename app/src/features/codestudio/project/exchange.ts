// Export and import of a project (DESIGN 3.7). The .zip holds every file at its path, a generated README.md,
// opennote-project.json (the settings and each file's ID and order), and opennote-tests.json (the test cases), so
// export then import gives the same files and tests. Import takes loose files or a .zip: UTF-8 text within the
// limits goes in, and everything else is listed as skipped with the reason.

import { t } from '../../../strings/t';
import { CODE_PROJECT_VERSION, COMPARE_MODES, PROJECT_LANGUAGES, PROJECT_LIMITS, RUNTIME_IDS, TEST_KINDS } from '../contracts';
import type { CodeFile, CodeProject, TestCase } from '../contracts';
import { NAME_CHARS, RESERVED_ROOT_FILES, nextId, nextOrder, readProject, sortedFiles } from './model';
import { pathKey, pathProblemAmong } from './paths';
import { limitRefusal, replacing } from './store';
import type { Refusal } from './store';
import { looksLikeZip, readZip, writeZip } from './zip';
import type { ZipCaps, ZipEntry } from './zip';

export const MANIFEST = 'opennote-project.json';
export const TESTS_FILE = 'opennote-tests.json';
const README = 'README.md';
/** The export files an archive holds beside the project's own files. */
const EXPORT_FILES = 3;
/**
 * The most a .zip may unpack to before import refuses it unread: a full project and the three export files, each
 * of those within the file limit.
 */
export const ZIP_CAPS: ZipCaps = {
  entries: PROJECT_LIMITS.files + EXPORT_FILES,
  totalBytes: PROJECT_LIMITS.projectBytes + EXPORT_FILES * PROJECT_LIMITS.fileBytes,
};
const ID = /^[A-Za-z0-9_-]{1,32}$/;
/** What opennote-project.json says it is, so import knows an OpenNote export from any other JSON file. */
const MANIFEST_FORMAT = 'opennote-code-project';

const encoder = new TextEncoder();

/** The generated README.md: the name, the language, the main file, and how to run it. */
export function readmeOf(project: CodeProject): string {
  const main = project.files[project.main]?.path ?? '';
  const language = t(`codeStudio.project.languages.${project.language}`);
  const lines = [
    t('codeStudio.project.exchange.readmeTitle', { name: project.name || t('codeStudio.project.block') }),
    '',
    t('codeStudio.project.exchange.readmeLanguage', { language }),
    ...(main ? [t('codeStudio.project.exchange.readmeMain', { path: main })] : []),
    '',
    t('codeStudio.project.exchange.readmeRun'),
    '',
    t('codeStudio.project.exchange.readmeFiles'),
  ];
  return `${lines.join('\n')}\n`;
}

/** opennote-project.json: everything but the file texts and the tests. */
export function manifestOf(project: CodeProject): Record<string, unknown> {
  return {
    format: MANIFEST_FORMAT,
    v: project.v,
    minEditor: project.minEditor,
    name: project.name,
    language: project.language,
    runtime: project.runtime,
    main: project.files[project.main]?.path ?? null,
    stdin: project.stdin,
    args: project.args,
    settings: project.settings,
    files: sortedFiles(project.files).map(([id, file]) => ({ id, path: file.path, order: file.order })),
  };
}

const json = (value: unknown) => encoder.encode(`${JSON.stringify(value, null, 2)}\n`);

/** The .zip of a project. A project's own README.md is kept, and then no README is generated. */
export function exportZip(project: CodeProject): Uint8Array {
  const files = sortedFiles(project.files);
  const entries: ZipEntry[] = files.map(([, file]) => ({ path: file.path, bytes: encoder.encode(file.text) }));
  const hasReadme = files.some(([, file]) => pathKey(file.path) === pathKey(README));
  if (!hasReadme) entries.push({ path: README, bytes: encoder.encode(readmeOf(project)) });
  entries.push({ path: MANIFEST, bytes: json(manifestOf(project)) });
  const tests = Object.values(project.tests).sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
  entries.push({ path: TESTS_FILE, bytes: json({ format: MANIFEST_FORMAT, tests }) });
  return writeZip(entries);
}

/** One file as a download: its name and its bytes. */
export function fileDownload(project: CodeProject, id: string): { name: string; bytes: Uint8Array } | null {
  const file = project.files[id];
  if (!file) return null;
  return { name: file.path.slice(file.path.lastIndexOf('/') + 1), bytes: encoder.encode(file.text) };
}

export type SkipReason = 'binary' | 'path' | 'tooBig' | 'test';

export interface ImportPlan {
  /** The merge patch to send, or null when nothing changes. */
  patch: Record<string, unknown> | null;
  added: string[];
  replaced: string[];
  skipped: { path: string; reason: SkipReason }[];
  /** Set when the whole import is refused: the project would break a limit. */
  refusal: Refusal | null;
}

const strict = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

function utf8(bytes: Uint8Array): string | null {
  try {
    // A byte order mark stays, so export then import gives the same text.
    return strict.decode(bytes);
  } catch {
    return null;
  }
}

/** An archive's entries that all start with the same folder lose it, so `project/main.py` imports as `main.py`. */
function withoutCommonFolder<T extends { path: string }>(entries: T[]): T[] {
  if (entries.length === 0) return entries;
  const first = entries[0].path.split('/')[0];
  const shared = entries.every((entry) => entry.path.includes('/') && entry.path.split('/')[0] === first);
  return shared ? entries.map((entry) => ({ ...entry, path: entry.path.slice(first.length + 1) })) : entries;
}

const isMap = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function parseJson(bytes: Uint8Array | undefined): Record<string, unknown> | null {
  const text = bytes ? utf8(bytes) : null;
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return isMap(value) && value.format === MANIFEST_FORMAT ? value : null;
  } catch {
    return null;
  }
}

const isText = (value: unknown) => value === undefined || typeof value === 'string';
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** An imported test case of the stored shape (contracts/testing.ts), or null. */
function testCase(value: unknown): TestCase | null {
  if (!isMap(value)) return null;
  const { id, name, kind, expected, compare, order, args, timeMs, rowsOrdered } = value;
  // `__proto__` and the other Object.prototype names fit the ID pattern, but as keys they would not be data.
  if (
    typeof id !== 'string' ||
    !ID.test(id) ||
    id in Object.prototype ||
    typeof name !== 'string' ||
    typeof expected !== 'string'
  )
    return null;
  if (!(TEST_KINDS as readonly unknown[]).includes(kind) || !isFiniteNumber(order)) return null;
  if (!isMap(compare) || !(COMPARE_MODES as readonly unknown[]).includes(compare.mode)) return null;
  if (compare.tolerance !== undefined && !isFiniteNumber(compare.tolerance)) return null;
  if (compare.relative !== undefined && typeof compare.relative !== 'boolean') return null;
  if (!isText(value.stdin) || !isText(value.fn) || !isText(value.callArgs)) return null;
  if (args !== undefined && !(Array.isArray(args) && args.every((arg) => typeof arg === 'string'))) return null;
  if (timeMs !== undefined && !(isFiniteNumber(timeMs) && timeMs > 0)) return null;
  if (rowsOrdered !== undefined && typeof rowsOrdered !== 'boolean') return null;
  // Only the stored fields go in, so an import cannot write anything else into the page.
  const keys = ['id', 'name', 'kind', 'stdin', 'args', 'fn', 'callArgs', 'expected', 'rowsOrdered', 'timeMs', 'order'];
  const out: Record<string, unknown> = {};
  for (const key of keys) if (value[key] !== undefined) out[key] = value[key];
  const spec: Record<string, unknown> = { mode: compare.mode };
  if (compare.tolerance !== undefined) spec.tolerance = compare.tolerance;
  if (compare.relative !== undefined) spec.relative = compare.relative;
  out.compare = spec;
  return out as unknown as TestCase;
}

/**
 * Whether a project is still the starter that Insert gives: one main.py with the starter text, the starter name,
 * and no tests, input, or arguments. Importing an export into it restores the export's settings.
 */
export function isFreshStarter(project: CodeProject): boolean {
  const files = Object.values(project.files);
  return (
    files.length === 1 &&
    files[0].path === 'main.py' &&
    files[0].text === t('codeStudio.project.starterMain') &&
    project.name === t('codeStudio.project.starterName') &&
    Object.keys(project.tests).length === 0 &&
    project.stdin === '' &&
    project.args.length === 0
  );
}

/**
 * What importing these entries into the project would do. An OpenNote export restores each file's ID and order
 * where they are free, and its tests. Into an empty project, or the untouched starter, it also restores the name
 * and the settings, and the starter's file gives way to the export's files. A file whose path is already in the
 * project replaces that file's text. A test case that is not of the stored shape is listed as skipped.
 */
export function planImport(
  project: CodeProject,
  entries: readonly (ZipEntry | { path: string; tooBig: true })[],
): ImportPlan {
  const plan: ImportPlan = { patch: null, added: [], replaced: [], skipped: [], refusal: null };
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const manifestEntry = byPath.get(MANIFEST);
  const manifest = parseJson(manifestEntry && 'bytes' in manifestEntry ? manifestEntry.bytes : undefined);
  const testsEntry = byPath.get(TESTS_FILE);
  const testsFile = manifest ? parseJson(testsEntry && 'bytes' in testsEntry ? testsEntry.bytes : undefined) : null;
  const listed = new Map<string, { id?: string; order?: number }>();
  if (manifest && Array.isArray(manifest.files)) {
    for (const item of manifest.files) {
      if (isMap(item) && typeof item.path === 'string') {
        listed.set(item.path, {
          ...(typeof item.id === 'string' ? { id: item.id } : {}),
          ...(typeof item.order === 'number' ? { order: item.order } : {}),
        });
      }
    }
  }

  const fresh = manifest !== null && (Object.keys(project.files).length === 0 || isFreshStarter(project));
  // Into a fresh project the starter's file goes, so the export's own IDs and paths come back.
  const files: Record<string, CodeFile> = fresh ? {} : { ...project.files };
  const filePatch: Record<string, unknown> = {};
  for (const [path, entry] of byPath) {
    if (manifest && (path === MANIFEST || (path === TESTS_FILE && testsFile))) continue;
    // A generated README stays out: the export lists the project's own README among its files.
    if (manifest && path === README && !listed.has(README)) continue;
    if (!('bytes' in entry)) {
      plan.skipped.push({ path, reason: 'tooBig' });
      continue;
    }
    const text = utf8(entry.bytes);
    if (text === null) {
      plan.skipped.push({ path, reason: 'binary' });
      continue;
    }
    const normalized = path.normalize('NFC');
    const existing = Object.entries(files).find(([, file]) => pathKey(file.path) === pathKey(normalized));
    if (existing) {
      const [id] = existing;
      files[id] = { ...files[id], text };
      filePatch[id] = { ...(isMap(filePatch[id]) ? filePatch[id] : {}), text };
      plan.replaced.push(normalized);
      continue;
    }
    const others = Object.values(files).map((file) => file.path);
    const reserved = (RESERVED_ROOT_FILES as readonly string[]).includes(normalized.toLowerCase());
    if (reserved || pathProblemAmong(normalized, others)) {
      plan.skipped.push({ path, reason: 'path' });
      continue;
    }
    const hint = listed.get(normalized);
    const id = hint?.id && /^[A-Za-z0-9_-]{1,32}$/.test(hint.id) && !(hint.id in files) ? hint.id : nextId('f', files);
    const file: CodeFile = { path: normalized, text, order: hint?.order ?? nextOrder(files) };
    files[id] = file;
    filePatch[id] = file;
    plan.added.push(normalized);
  }

  // When nothing came in, the starter's file stays, so a project always keeps a file.
  if (fresh && Object.keys(files).length === 0) Object.assign(files, project.files);
  else if (fresh) {
    // A starter file the export does not bring back is deleted, and one whose ID it reuses is replaced whole.
    for (const id of Object.keys(project.files)) {
      filePatch[id] = id in filePatch ? replacing(project.files[id], filePatch[id]) : null;
    }
  }
  const patch: Record<string, unknown> = {};
  if (Object.keys(filePatch).length > 0) patch.files = filePatch;
  const tests: Record<string, TestCase> = { ...project.tests };
  if (testsFile && Array.isArray(testsFile.tests)) {
    const testPatch: Record<string, unknown> = {};
    for (const [index, item] of testsFile.tests.entries()) {
      const test = testCase(item);
      if (!test) {
        const label = isMap(item) && typeof item.name === 'string' ? item.name : `${TESTS_FILE} #${index + 1}`;
        plan.skipped.push({ path: label, reason: 'test' });
        continue;
      }
      testPatch[test.id] = replacing(Object.hasOwn(tests, test.id) ? tests[test.id] : undefined, test);
      tests[test.id] = test;
    }
    if (Object.keys(testPatch).length > 0) patch.tests = testPatch;
  }
  if (manifest && fresh) Object.assign(patch, settingsFrom(manifest, files));
  else if (!files[project.main] && Object.keys(files).length > 0) patch.main = sortedFiles(files)[0][0];

  const next = readProject({ ...projectData(project), ...patch, files, tests });
  plan.refusal = limitRefusal(next);
  plan.patch = plan.refusal || Object.keys(patch).length === 0 ? null : patch;
  return plan;
}

/** The most arguments an import restores. */
const ARGS_MAX = 256;
/** The most skipped names the import sentence lists; the count still holds them all. */
export const SKIPS_LISTED = 10;

/** Text within a byte limit, measured as UTF-8. */
const fits = (text: string, bytes: number) => text.length <= bytes && encoder.encode(text).length <= bytes;

/**
 * The fields an export restores into an empty project or the untouched starter. Each goes through the model first:
 * a language or runtime this app does not know stays out, the settings keep only their known keys within range, and
 * the name, input, and arguments are bounded, so a crafted manifest cannot write anything else into the page.
 */
function settingsFrom(manifest: Record<string, unknown>, files: Record<string, CodeFile>): Record<string, unknown> {
  const out: Record<string, unknown> = { v: CODE_PROJECT_VERSION };
  const { name, language, runtime, stdin, args } = manifest;
  if (typeof name === 'string') out.name = Array.from(name).slice(0, NAME_CHARS).join('');
  if ((PROJECT_LANGUAGES as readonly unknown[]).includes(language)) out.language = language;
  if (runtime === 'toolchain' || (RUNTIME_IDS as readonly unknown[]).includes(runtime)) out.runtime = runtime;
  if (typeof stdin === 'string' && fits(stdin, PROJECT_LIMITS.fileBytes)) out.stdin = stdin;
  if (Array.isArray(args)) {
    const texts = args.filter((arg): arg is string => typeof arg === 'string');
    if (texts.length <= ARGS_MAX && fits(texts.join(''), PROJECT_LIMITS.fileBytes)) out.args = texts;
  }
  if (isMap(manifest.settings)) out.settings = readProject({ settings: manifest.settings }).settings;
  const main = Object.entries(files).find(([, file]) => file.path === manifest.main)?.[0];
  out.main = main ?? sortedFiles(files)[0]?.[0] ?? '';
  return out;
}

function projectData(project: CodeProject): Record<string, unknown> {
  return { ...project } as unknown as Record<string, unknown>;
}

/** The entries of picked files: a .zip is opened, and other files go in by name. */
export async function entriesOf(
  files: readonly { name: string; bytes: Uint8Array }[],
): Promise<(ZipEntry | { path: string; tooBig: true })[]> {
  const out: (ZipEntry | { path: string; tooBig: true })[] = [];
  for (const file of files) {
    if (file.name.toLowerCase().endsWith('.zip') || looksLikeZip(file.bytes)) {
      out.push(...withoutCommonFolder(await readZip(file.bytes, PROJECT_LIMITS.fileBytes, ZIP_CAPS)));
    } else if (file.bytes.length > PROJECT_LIMITS.fileBytes) {
      out.push({ path: file.name, tooBig: true });
    } else {
      out.push({ path: file.name, bytes: file.bytes });
    }
  }
  return out;
}

/** The sentence that reports an import. */
export function importSummary(plan: ImportPlan): string {
  if (plan.refusal) return plan.refusal.message;
  const parts = [t('codeStudio.project.exchange.imported', { count: plan.added.length + plan.replaced.length })];
  if (plan.skipped.length > 0) {
    const key = { binary: 'skipBinary', path: 'skipPath', tooBig: 'skipTooBig', test: 'skipTest' } as const;
    const shown = plan.skipped.slice(0, SKIPS_LISTED);
    const list = shown.map((skip) => t(`codeStudio.project.exchange.${key[skip.reason]}`, { path: skip.path }));
    const more = plan.skipped.length - shown.length;
    if (more > 0) list.push(t('codeStudio.project.exchange.skipMore', { count: more }));
    parts.push(t('codeStudio.project.exchange.skipped', { count: plan.skipped.length, list: list.join(', ') }));
  }
  return parts.join(' ');
}

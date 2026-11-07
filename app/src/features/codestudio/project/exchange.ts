// Export and import of a project (DESIGN 3.7). The .zip holds every file at its path, a generated README.md,
// opennote-project.json (the settings and each file's ID and order), and opennote-tests.json (the test cases), so
// export then import gives the same files and tests. Import takes loose files or a .zip: UTF-8 text within the
// limits goes in, and everything else is listed as skipped with the reason.

import { t } from '../../../strings/t';
import { CODE_PROJECT_VERSION, PROJECT_LIMITS } from '../contracts';
import type { CodeFile, CodeProject, TestCase } from '../contracts';
import { RESERVED_ROOT_FILES, nextId, nextOrder, readProject, sortedFiles } from './model';
import { pathKey, pathProblemAmong } from './paths';
import { limitRefusal, replacing } from './store';
import type { Refusal } from './store';
import { looksLikeZip, readZip, writeZip } from './zip';
import type { ZipEntry } from './zip';

export const MANIFEST = 'opennote-project.json';
export const TESTS_FILE = 'opennote-tests.json';
const README = 'README.md';
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

export type SkipReason = 'binary' | 'path' | 'tooBig';

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

/**
 * What importing these entries into the project would do. An OpenNote export restores each file's ID and order
 * where they are free, and its tests. Into an empty project it also restores the name and the settings. A file
 * whose path is already in the project replaces that file's text.
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

  const empty = Object.keys(project.files).length === 0;
  const files: Record<string, CodeFile> = { ...project.files };
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

  const patch: Record<string, unknown> = {};
  if (Object.keys(filePatch).length > 0) patch.files = filePatch;
  const tests: Record<string, TestCase> = { ...project.tests };
  if (testsFile && Array.isArray(testsFile.tests)) {
    const testPatch: Record<string, unknown> = {};
    for (const test of testsFile.tests) {
      if (!isMap(test) || typeof test.id !== 'string') continue;
      const id = test.id;
      testPatch[id] = replacing(tests[id], test);
      tests[id] = test as unknown as TestCase;
    }
    if (Object.keys(testPatch).length > 0) patch.tests = testPatch;
  }
  if (manifest && empty) Object.assign(patch, settingsFrom(manifest, files));
  else if (!files[project.main] && Object.keys(files).length > 0) patch.main = sortedFiles(files)[0][0];

  const next = readProject({ ...projectData(project), ...patch, files, tests });
  plan.refusal = limitRefusal(next);
  plan.patch = plan.refusal || Object.keys(patch).length === 0 ? null : patch;
  return plan;
}

/** The fields an export restores into an empty project. */
function settingsFrom(manifest: Record<string, unknown>, files: Record<string, CodeFile>): Record<string, unknown> {
  const out: Record<string, unknown> = { v: CODE_PROJECT_VERSION };
  for (const key of ['name', 'language', 'runtime', 'stdin'] as const) {
    if (typeof manifest[key] === 'string') out[key] = manifest[key];
  }
  if (Array.isArray(manifest.args)) out.args = manifest.args.filter((arg) => typeof arg === 'string');
  if (isMap(manifest.settings)) out.settings = manifest.settings;
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
      out.push(...withoutCommonFolder(await readZip(file.bytes, PROJECT_LIMITS.fileBytes)));
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
    const key = { binary: 'skipBinary', path: 'skipPath', tooBig: 'skipTooBig' } as const;
    const list = plan.skipped.map((skip) => t(`codeStudio.project.exchange.${key[skip.reason]}`, { path: skip.path }));
    parts.push(t('codeStudio.project.exchange.skipped', { count: plan.skipped.length, list: list.join(', ') }));
  }
  return parts.join(' ');
}

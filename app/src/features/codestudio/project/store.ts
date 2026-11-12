// The project store over a code project block. Typing in a file sends a JSON merge patch (RFC 7396) of that one
// file, `data.files.<id>.text`, 400 ms after the typing stops, so other files and other devices' edits to them are
// untouched. New file, rename, move, and delete are patches of their own, so the page's undo takes each back in
// one step. Every change keeps the limits of DESIGN 3.1 and is refused with the reason when it would break one.

import { applyMergePatch } from '../../../platform/mergePatch';
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { PROJECT_LIMITS } from '../contracts';
import type { CodeFile, CodeProject, TestCase } from '../contracts';
import { projectFallback } from './fallback';
import {
  RESERVED_ROOT_FILES,
  canEdit,
  nextId,
  nextOrder,
  projectBytes,
  readProject,
  sortedFiles,
  utf8Bytes,
} from './model';
import { isReservedName, pathProblemAmong } from './paths';
import type { PathProblem } from './paths';

/** How long typing must pause before the file's text is sent to the page. */
export const TYPING_DELAY_MS = 400;

export type RefusalCode =
  | 'readOnly'
  | 'noFile'
  | 'tooManyFiles'
  | 'fileTooBig'
  | 'projectTooBig'
  | 'tooManyTests'
  | 'lastFile'
  | 'reservedName'
  | `path.${PathProblem}`;

export interface Refusal {
  ok: false;
  code: RefusalCode;
  /** The reason in words, for the person. */
  message: string;
}

export type Outcome<T = undefined> = { ok: true; value: T } | Refusal;

/** What the store sends: a merge patch of the block's data, and the new fallback. */
export type PatchProject = (data: Record<string, unknown>, fallback: string) => void;

export interface ProjectStoreOptions {
  data: Record<string, unknown>;
  patch: PatchProject;
  readOnly?: boolean;
  delayMs?: number;
}

const MIB = (bytes: number) => `${bytes / (1024 * 1024)} MiB`;

/** A refusal with its message. */
export function refusal(code: RefusalCode, params: Record<string, string | number> = {}): Refusal {
  // The codes and the message keys are the same list; each message takes a subset of these parameters.
  const say = t as (key: MessageKey, values: Record<string, string | number>) => string;
  return { ok: false, code, message: say(`codeStudio.project.refusal.${code}`, params) };
}

/** The refusal for a path problem. */
export function pathRefusal(problem: PathProblem, path: string): Refusal {
  const segment = path.split('/').find((part) => isReservedName(part)) ?? path;
  return refusal(`path.${problem}`, { max: PROJECT_LIMITS.pathChars, name: segment, path });
}

const ok = <T>(value: T): Outcome<T> => ({ ok: true, value });

export interface ProjectStore {
  /** The project as the person sees it, typing not yet sent included. */
  project(): CodeProject;
  readonly editable: boolean;
  /** Keeps a file's new text and sends it when typing pauses. */
  editFile(id: string, text: string): Outcome;
  /** Sends any text still waiting. */
  flush(): void;
  newFile(path: string, text?: string): Outcome<string>;
  renameFile(id: string, path: string): Outcome;
  /** Moves a file into a folder (`''` is the root), keeping its name. */
  moveFile(id: string, folder: string): Outcome;
  deleteFile(id: string): Outcome;
  /** Adds or replaces a test case; null deletes it. */
  setTest(id: string, test: TestCase | null): Outcome;
  /** Sends a whole merge patch built elsewhere (an import), after checking its result against the limits. */
  apply(patch: Record<string, unknown>): Outcome;
  /** Takes the page's newer data (another device, an undo). Text still waiting is kept on top. */
  update(data: Record<string, unknown>, readOnly?: boolean): void;
  /** Sends what is waiting and stops the timer. */
  dispose(): void;
}

/** Checks a project against the limits, for the files and tests it would hold. */
export function limitRefusal(project: CodeProject): Refusal | null {
  const files = Object.values(project.files);
  if (files.length > PROJECT_LIMITS.files) return refusal('tooManyFiles', { max: PROJECT_LIMITS.files });
  for (const file of files) {
    if (utf8Bytes(file.text) > PROJECT_LIMITS.fileBytes) {
      return refusal('fileTooBig', { path: file.path, max: MIB(PROJECT_LIMITS.fileBytes) });
    }
  }
  if (projectBytes(project.files) > PROJECT_LIMITS.projectBytes) {
    return refusal('projectTooBig', { max: MIB(PROJECT_LIMITS.projectBytes) });
  }
  if (Object.keys(project.tests).length > PROJECT_LIMITS.tests) {
    return refusal('tooManyTests', { max: PROJECT_LIMITS.tests });
  }
  return null;
}

/** Applies a merge patch to a project's data, the way the core does (RFC 7396). */
export const mergeData = (target: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> =>
  applyMergePatch(target, patch);

/** A merge patch that turns `before` into exactly `after`: every key `after` lacks becomes null, at every level. */
export function replacing(before: unknown, after: unknown): unknown {
  const isMap = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  if (!isMap(after) || !isMap(before)) return after;
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(before)) if (!(key in after)) patch[key] = null;
  for (const [key, value] of Object.entries(after)) patch[key] = replacing(before[key], value);
  return patch;
}

/** A file change worked out against the project: a refusal, or the patch to send and the value to return. */
type Change<T> = Refusal | { patch: Record<string, unknown>; value: T };

/** Checks a new path against the project's other paths and the reserved export names. */
function checkPath(project: CodeProject, path: string, except?: string): Refusal | null {
  const others = Object.entries(project.files)
    .filter(([id]) => id !== except)
    .map(([, file]) => file.path);
  const problem = pathProblemAmong(path, others);
  if (problem) return pathRefusal(problem, path);
  if ((RESERVED_ROOT_FILES as readonly string[]).includes(path.toLowerCase())) return refusal('reservedName', { path });
  return null;
}

function newFileChange(project: CodeProject, path: string, text: string): Change<string> {
  if (Object.keys(project.files).length >= PROJECT_LIMITS.files) {
    return refusal('tooManyFiles', { max: PROJECT_LIMITS.files });
  }
  const bad = checkPath(project, path);
  if (bad) return bad;
  const id = nextId('f', project.files);
  const file: CodeFile = { path, text, order: nextOrder(project.files) };
  const patch: Record<string, unknown> = { files: { [id]: file } };
  if (!project.files[project.main]) patch.main = id;
  return { patch, value: id };
}

function renameChange(project: CodeProject, id: string, path: string): Change<undefined> {
  if (!project.files[id]) return refusal('noFile');
  const bad = checkPath(project, path, id);
  if (bad) return bad;
  return { patch: { files: { [id]: { path } } }, value: undefined };
}

function deleteChange(project: CodeProject, id: string): Change<undefined> {
  if (!project.files[id]) return refusal('noFile');
  if (Object.keys(project.files).length === 1) return refusal('lastFile');
  const patch: Record<string, unknown> = { files: { [id]: null } };
  if (project.main === id) patch.main = sortedFiles(project.files).find(([other]) => other !== id)?.[0] ?? '';
  return { patch, value: undefined };
}

function testChange(project: CodeProject, id: string, test: TestCase | null): Change<undefined> {
  if (!test) return { patch: { tests: { [id]: null } }, value: undefined };
  if (!project.tests[id] && Object.keys(project.tests).length >= PROJECT_LIMITS.tests) {
    return refusal('tooManyTests', { max: PROJECT_LIMITS.tests });
  }
  // A test replaces the old one whole: a field the new one lacks is removed, not kept from the old one.
  return { patch: { tests: { [id]: replacing(project.tests[id], { ...test, id }) } }, value: undefined };
}

/** Whether new text for a file keeps the file and project limits. `size` gives a file's UTF-8 bytes by ID. */
function textRefusal(
  project: CodeProject,
  id: string,
  text: string,
  size: (id: string, text: string) => number,
): Refusal | null {
  const file = project.files[id];
  const bytes = utf8Bytes(text);
  if (bytes > PROJECT_LIMITS.fileBytes) {
    return refusal('fileTooBig', { path: file.path, max: MIB(PROJECT_LIMITS.fileBytes) });
  }
  let total = bytes;
  for (const [other, entry] of Object.entries(project.files)) if (other !== id) total += size(other, entry.text);
  return total > PROJECT_LIMITS.projectBytes
    ? refusal('projectTooBig', { max: MIB(PROJECT_LIMITS.projectBytes) })
    : null;
}

class Store implements ProjectStore {
  private data: Record<string, unknown>;
  private readOnly: boolean;
  private readonly pending = new Map<string, string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** Each file's UTF-8 size for the text it was counted at, so a keystroke encodes only the changed text. */
  private readonly sizes = new Map<string, { text: string; bytes: number }>();

  constructor(private readonly options: ProjectStoreOptions) {
    this.data = options.data;
    this.readOnly = options.readOnly ?? false;
  }

  get editable(): boolean {
    return !this.readOnly && canEdit(this.data);
  }

  project(): CodeProject {
    const project = readProject(this.data);
    for (const [id, text] of this.pending) {
      const file = project.files[id];
      if (file) project.files[id] = { ...file, text };
    }
    return project;
  }

  private sizeOf(id: string, text: string): number {
    const known = this.sizes.get(id);
    if (known && known.text === text) return known.bytes;
    const bytes = utf8Bytes(text);
    this.sizes.set(id, { text, bytes });
    return bytes;
  }

  editFile(id: string, text: string): Outcome {
    if (!this.editable) return refusal('readOnly');
    const project = this.project();
    const file = project.files[id];
    if (!file) return refusal('noFile');
    const over = textRefusal(project, id, text, (other, current) => this.sizeOf(other, current));
    if (over) return over;
    this.pending.set(id, text);
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.options.delayMs ?? TYPING_DELAY_MS);
    return ok(undefined);
  }

  flush(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending.size === 0) return;
    const files: Record<string, { text: string }> = {};
    for (const [id, text] of this.pending) files[id] = { text };
    this.pending.clear();
    this.send({ files });
  }

  newFile(path: string, text = ''): Outcome<string> {
    return this.structural((project) => newFileChange(project, path, text));
  }

  renameFile(id: string, path: string): Outcome {
    return this.structural((project) => renameChange(project, id, path));
  }

  moveFile(id: string, folder: string): Outcome {
    const file = this.project().files[id];
    if (!file) return refusal(this.editable ? 'noFile' : 'readOnly');
    const name = file.path.slice(file.path.lastIndexOf('/') + 1);
    const trimmed = folder.replace(/\/+$/, '');
    return this.renameFile(id, trimmed ? `${trimmed}/${name}` : name);
  }

  deleteFile(id: string): Outcome {
    return this.structural((project) => deleteChange(project, id));
  }

  setTest(id: string, test: TestCase | null): Outcome {
    return this.structural((project) => testChange(project, id, test));
  }

  apply(patch: Record<string, unknown>): Outcome {
    return this.structural(() => ({ patch, value: undefined }));
  }

  update(next: Record<string, unknown>, readOnly?: boolean): void {
    this.data = next;
    if (readOnly !== undefined) this.readOnly = readOnly;
    const files = readProject(next).files;
    for (const id of this.pending.keys()) if (!files[id]) this.pending.delete(id);
  }

  dispose(): void {
    this.flush();
  }

  /** Sends a patch and keeps the page's data in step with it. */
  private send(patch: Record<string, unknown>): void {
    this.data = mergeData(this.data, patch);
    this.options.patch(patch, projectFallback(this.project()));
  }

  /** Runs a file change: the text waiting goes first, then the change as its own undo step. */
  private structural<T>(change: (project: CodeProject) => Change<T>): Outcome<T> {
    if (!this.editable) return refusal('readOnly');
    this.flush();
    const result = change(this.project());
    if ('ok' in result) return result;
    const over = limitRefusal(readProject(mergeData(this.data, result.patch)));
    if (over) return over;
    this.send(result.patch);
    return ok(result.value);
  }
}

export function createProjectStore(options: ProjectStoreOptions): ProjectStore {
  return new Store(options);
}

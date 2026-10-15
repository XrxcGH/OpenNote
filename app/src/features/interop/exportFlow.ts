// The export flow: choose what to export, the format, and the folder; export with progress and Cancel; show the
// summary. The host makes a new folder or file in the chosen folder, so nothing is overwritten.

import type {
  ExportFormat,
  ExportResult,
  ExportScope,
  InteropClient,
  JobEvent,
  JobProgress,
} from '../../platform/interop';
import { isEnabled } from '../../app/flags';
import type { IpcError } from '../../platform/types';
import type { NotesService } from '../../services/notes/types';
import { t } from '../../strings/t';
import { collectRequest, pageCount } from './exportTarget';
import type { ExportTarget } from './exportTarget';
import { createFlowState, newJobName } from './flowState';
import type { FlowState } from './flowState';

export type ExportState =
  | { step: 'options'; scope: ExportScope; format: ExportFormat; folder: string | null; error: IpcError | null }
  | {
      step: 'exporting';
      job: string;
      scope: ExportScope;
      format: ExportFormat;
      folder: string;
      name: string;
      progress: JobProgress | null;
    }
  | { step: 'done'; result: ExportResult }
  | { step: 'empty'; scope: ExportScope };

/** A file that an export made, which can be updated after the notes change. */
export interface SentCopy {
  /** The node of the notes tree that was exported. */
  node: string;
  format: ExportFormat;
  path: string;
}

/** What the host remembers for sending copies to folders. */
export interface SendExtras {
  favorites: string[];
  copies: SentCopy[];
}

/** The formats that write one file, so a copy can be replaced. */
const ONE_FILE: readonly ExportFormat[] = ['docx', 'htmlSingle', 'pptx', 'xlsx'];

export const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

export interface ExportFlow {
  readonly state: FlowState<ExportState>;
  /** The favorite folders and the copies sent before, when the host remembers them. */
  readonly extras: FlowState<SendExtras>;
  /** Uses a folder, such as a favorite one. */
  useFolder(path: string): void;
  /** Adds the chosen folder to the favorites, or takes it out. */
  toggleFavorite(): Promise<void>;
  /** Exports again over a copy that was sent before. */
  update(copy: SentCopy): Promise<void>;
  setScope(scope: ExportScope): void;
  setFormat(format: ExportFormat): void;
  chooseFolder(): Promise<void>;
  start(): Promise<void>;
  cancel(): void;
  /** After an empty result: back to choosing what to export. */
  back(): void;
  running(): boolean;
  /** Listens for progress while the dialog is open. The returned function stops listening and cancels any job. */
  attach(): () => void;
}

export interface ExportFlowDeps {
  interop: InteropClient;
  notes: NotesService;
  target: ExportTarget;
  announce(text: string, politeness?: 'polite' | 'assertive'): void;
}

function asError(error: unknown): IpcError {
  if (typeof error === 'object' && error !== null && typeof (error as IpcError).code === 'string') {
    return error as IpcError;
  }
  return { code: 'unknown', message: String(error) };
}

/** What the steps share: the dependencies, the state, and the name of the job that is running. */
interface Run {
  deps: ExportFlowDeps;
  state: FlowState<ExportState>;
  extras: FlowState<SendExtras>;
  job: string | null;
}

type Options = Extract<ExportState, { step: 'options' }>;

const optionsOf = (run: Run): Options | null => {
  const current = run.state.get();
  return current.step === 'options' ? current : null;
};

async function chooseFolder(run: Run): Promise<void> {
  const current = optionsOf(run);
  if (!current) return;
  const folder = await run.deps.interop.pick('folder', current.folder);
  const latest = optionsOf(run);
  if (folder && latest) run.state.set({ ...latest, folder, error: null });
}

/** Collects the tree for the chosen scope and runs the export. Failures return to the options. */
async function exportNow(run: Run, options: Options & { folder: string }, replace?: string): Promise<void> {
  const { interop, notes, target } = run.deps;
  const { scope, format, folder } = options;
  const name = newJobName('export');
  try {
    const collected = await collectRequest(notes, target, scope);
    if (pageCount(collected) === 0) {
      run.state.set({ step: 'empty', scope });
      return;
    }
    run.job = name;
    const shown = target.choices.find((choice) => choice.scope === scope)?.node.title ?? collected.title;
    run.state.set({ step: 'exporting', job: name, scope, format, folder, name: shown, progress: null });
    const outcome = await interop.exportTo(name, { ...collected, format, folder, ...(replace ? { replace } : {}) });
    if (outcome.status === 'done') {
      run.state.set({ step: 'done', result: outcome.result });
      await rememberCopy(run, scope, format, outcome.result.reveal);
      return;
    }
    run.state.set({ step: 'options', scope, format, folder, error: null });
    run.deps.announce(t('interop.export.canceled'));
  } catch (error) {
    run.state.set({ step: 'options', scope, format, folder, error: asError(error) });
  } finally {
    if (run.job === name) run.job = null;
  }
}

/** Keeps a one-file export in the list of copies, so it can be updated later. */
async function rememberCopy(run: Run, scope: ExportScope, format: ExportFormat, path: string): Promise<void> {
  const { interop, target } = run.deps;
  const node = target.choices.find((choice) => choice.scope === scope)?.node.id;
  if (!interop.more || !node || !ONE_FILE.includes(format) || !isEnabled('interop.sendToFolder')) return;
  try {
    await interop.more('send_record', { node, format, path });
    await loadExtras(run);
  } catch {
    // The copy just cannot be updated later.
  }
}

/** Reads the favorite folders and the copies of this notebook's nodes from the host. */
async function loadExtras(run: Run): Promise<void> {
  const { interop, target } = run.deps;
  if (!interop.more || !isEnabled('interop.sendToFolder')) return;
  try {
    const found = await interop.more<SendExtras>('send_state', {});
    const mine = new Set<string>(target.choices.map((choice) => choice.node.id));
    run.extras.set({ favorites: found.favorites, copies: found.copies.filter((copy) => mine.has(copy.node)) });
  } catch {
    // Without the host's memory there are no favorites, and the folder is chosen by hand.
  }
}

function onProgress(run: Run, event: JobEvent): void {
  if (event.event !== 'progress' || event.job !== run.job) return;
  const current = run.state.get();
  if (current.step === 'exporting') run.state.set({ ...current, progress: event });
}

export function createExportFlow(deps: ExportFlowDeps): ExportFlow {
  const state = createFlowState<ExportState>({
    step: 'options',
    scope: deps.target.initial,
    format: 'markdown',
    folder: null,
    error: null,
  });
  const extras = createFlowState<SendExtras>({ favorites: [], copies: [] });
  const run: Run = { deps, state, extras, job: null };
  void loadExtras(run);
  return {
    state,
    extras,
    useFolder(folder) {
      const current = optionsOf(run);
      if (current) state.set({ ...current, folder, error: null });
    },
    async toggleFavorite() {
      const folder = optionsOf(run)?.folder;
      if (!folder || !deps.interop.more) return;
      const add = !extras.get().favorites.includes(folder);
      try {
        await deps.interop.more('send_favorite', { path: folder, add });
        await loadExtras(run);
      } catch (error) {
        const current = optionsOf(run);
        if (current) state.set({ ...current, error: asError(error) });
      }
    },
    async update(copy) {
      const scope = deps.target.choices.find((choice) => choice.node.id === copy.node)?.scope;
      if (!scope) return;
      const options: Options = {
        step: 'options',
        scope,
        format: copy.format,
        folder: folderOf(copy.path),
        error: null,
      };
      await exportNow(run, { ...options, folder: folderOf(copy.path) }, copy.path);
    },
    setScope(scope) {
      const current = optionsOf(run);
      if (current) state.set({ ...current, scope });
    },
    setFormat(format) {
      const current = optionsOf(run);
      if (current) state.set({ ...current, format });
    },
    chooseFolder: () => chooseFolder(run),
    async start() {
      // Without a folder yet, Export asks for one first and goes on once the person has chosen.
      if (!optionsOf(run)?.folder) await chooseFolder(run);
      const current = optionsOf(run);
      if (current?.folder) await exportNow(run, { ...current, folder: current.folder });
    },
    cancel() {
      if (run.job) deps.interop.cancel(run.job);
    },
    back() {
      const current = state.get();
      if (current.step === 'empty') {
        state.set({ step: 'options', scope: current.scope, format: 'markdown', folder: null, error: null });
      }
    },
    running: () => run.job !== null,
    attach() {
      const stop = deps.interop.onProgress((event) => onProgress(run, event));
      return () => {
        stop();
        if (run.job) deps.interop.cancel(run.job);
        run.job = null;
      };
    },
  };
}

// The import flow: choose a source, check it (the dry run), review what will and won't come over, import with
// progress and Cancel, and show the summary. Each step is one state; the dialog only draws the current one.
// Nothing is added until the person presses Import on the review.

import type {
  DetectedSource,
  ImportChoices,
  ImportPreview,
  ImportResult,
  InteropClient,
  JobEvent,
  JobProgress,
  LocalSources,
} from '../../platform/interop';
import type { IpcError } from '../../platform/types';
import type { NodeSummary, NotesService } from '../../services/notes/types';
import { t } from '../../strings/t';
import { addImportedNodes, findImportedNodes } from './addNodes';
import { createFlowState, newJobName } from './flowState';
import type { FlowState } from './flowState';

export type ImportState =
  | { step: 'choose'; canceled?: boolean }
  | { step: 'checking'; job: string; path: string; progress: JobProgress | null }
  | { step: 'unsupported'; path: string; detected: DetectedSource }
  | { step: 'review'; path: string; preview: ImportPreview; reportPage: boolean }
  | {
      step: 'importing';
      job: string;
      path: string;
      title: string;
      reportPage: boolean;
      progress: JobProgress | null;
      /** True once the host finished and the tree is being made. */
      building: boolean;
    }
  | {
      step: 'done';
      result: ImportResult;
      notebook: NodeSummary;
      firstSection: NodeSummary | null;
      firstPage: NodeSummary | null;
      undone: boolean;
    }
  | { step: 'failed'; error: IpcError; path: string; preview: ImportPreview | null; reportPage: boolean };

type Review = Extract<ImportState, { step: 'review' }>;

export interface ImportFlow {
  readonly state: FlowState<ImportState>;
  chooseFile(): Promise<void>;
  chooseFolder(): Promise<void>;
  /** What this PC keeps for other apps, such as the Sticky Notes database. */
  localSources(): Promise<LocalSources>;
  /** Checks a source the host already knows, such as the Sticky Notes database. */
  chooseLocal(path: string): Promise<void>;
  setReportPage(on: boolean): void;
  /** Imports what the review showed. */
  start(): Promise<void>;
  /** Stops the check or the import that is running. Does nothing otherwise. */
  cancel(): void;
  /** Back to choosing a source. */
  back(): void;
  /** After a failure: back to the review when there is one, else to choosing a source. */
  retry(): void;
  /** Moves the new notebook to the Trash. */
  undo(): Promise<void>;
  /** True while the host is working, so closing the dialog must cancel first. */
  running(): boolean;
  /** Listens for progress while the dialog is open. The returned function stops listening and cancels any job. */
  attach(): () => void;
}

export interface ImportFlowDeps {
  interop: InteropClient;
  notes: NotesService;
  announce(text: string, politeness?: 'polite' | 'assertive'): void;
}

/** What the steps share: the dependencies, the state, and the name of the job that is running. */
interface Run {
  deps: ImportFlowDeps;
  state: FlowState<ImportState>;
  job: string | null;
}

const choices = (reportPage: boolean): ImportChoices => ({ reportPage });

function asError(error: unknown): IpcError {
  if (typeof error === 'object' && error !== null && typeof (error as IpcError).code === 'string') {
    return error as IpcError;
  }
  return { code: 'unknown', message: String(error) };
}

/** Detects the source, then runs the dry run. A newer job replaces this one, and this one then stops quietly. */
async function check(run: Run, path: string, reportPage: boolean): Promise<void> {
  const { interop } = run.deps;
  const name = newJobName('check');
  run.job = name;
  run.state.set({ step: 'checking', job: name, path, progress: null });
  try {
    const detected = await interop.detect(path);
    if (run.job !== name) return;
    if (!detected.supported) {
      run.state.set({ step: 'unsupported', path, detected });
      return;
    }
    const outcome = await interop.preview(name, path, choices(reportPage));
    if (run.job !== name) return;
    if (outcome.status === 'canceled') run.state.set({ step: 'choose', canceled: true });
    else run.state.set({ step: 'review', path, preview: outcome.result, reportPage });
  } catch (error) {
    if (run.job === name) run.state.set({ step: 'failed', error: asError(error), path, preview: null, reportPage });
  } finally {
    if (run.job === name) run.job = null;
  }
}

/** The host has written the notebook: make its tree nodes and tell the host which page is which. */
async function finishImport(run: Run, result: ImportResult): Promise<void> {
  const { interop, notes } = run.deps;
  run.job = null;
  const importing = run.state.get();
  if (importing.step === 'importing') run.state.set({ ...importing, building: true, progress: null });
  const added = result.tree.notebookId
    ? await findImportedNodes(notes, result.tree)
    : await addImportedNodes(notes, result.tree);
  if (!result.tree.notebookId) await interop.adopt(result.tree.dir, added.pairs);
  run.state.set({
    step: 'done',
    result,
    notebook: added.notebook,
    firstSection: added.firstSection,
    firstPage: added.firstPage,
    undone: false,
  });
}

async function importFrom(run: Run, review: Review): Promise<void> {
  const { path, reportPage, preview } = review;
  const name = newJobName('import');
  run.job = name;
  run.state.set({
    step: 'importing',
    job: name,
    path,
    title: preview.notebookTitle,
    reportPage,
    progress: null,
    building: false,
  });
  try {
    const outcome = await run.deps.interop.importFrom(name, path, choices(reportPage));
    if (outcome.status === 'canceled') {
      run.state.set({ step: 'choose', canceled: true });
      run.deps.announce(t('interop.import.canceled'));
      return;
    }
    await finishImport(run, outcome.result);
  } catch (error) {
    run.state.set({ step: 'failed', error: asError(error), path, preview, reportPage });
  } finally {
    if (run.job === name) run.job = null;
  }
}

function onProgress(run: Run, event: JobEvent): void {
  if (event.event !== 'progress' || event.job !== run.job) return;
  const current = run.state.get();
  if (current.step === 'checking' || current.step === 'importing') run.state.set({ ...current, progress: event });
}

function retry(run: Run): void {
  const current = run.state.get();
  run.job = null;
  if (current.step === 'failed' && current.preview) {
    run.state.set({ step: 'review', path: current.path, preview: current.preview, reportPage: current.reportPage });
  } else {
    run.state.set({ step: 'choose' });
  }
}

async function undo(run: Run): Promise<void> {
  const current = run.state.get();
  if (current.step !== 'done' || current.undone) return;
  await run.deps.notes.trash([current.notebook.id]);
  run.state.set({ ...current, undone: true });
}

export function createImportFlow(deps: ImportFlowDeps): ImportFlow {
  const state = createFlowState<ImportState>({ step: 'choose' });
  const run: Run = { deps, state, job: null };

  async function pick(kind: 'file' | 'folder'): Promise<void> {
    if (state.get().step !== 'choose') return;
    const path = await deps.interop.pick(kind, null);
    if (path) await check(run, path, false);
  }

  return {
    state,
    chooseFile: () => pick('file'),
    chooseFolder: () => pick('folder'),
    localSources: () => deps.interop.localSources(),
    chooseLocal: (path) => (state.get().step === 'choose' ? check(run, path, false) : Promise.resolve()),
    setReportPage(on) {
      const current = state.get();
      if (current.step === 'review') state.set({ ...current, reportPage: on });
    },
    async start() {
      const current = state.get();
      if (current.step === 'review') await importFrom(run, current);
    },
    cancel() {
      if (run.job) deps.interop.cancel(run.job);
    },
    back() {
      run.job = null;
      state.set({ step: 'choose' });
    },
    retry: () => retry(run),
    undo: () => undo(run),
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

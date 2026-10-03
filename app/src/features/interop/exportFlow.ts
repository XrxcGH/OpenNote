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

export interface ExportFlow {
  readonly state: FlowState<ExportState>;
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
async function exportNow(run: Run, options: Options & { folder: string }): Promise<void> {
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
    const outcome = await interop.exportTo(name, { ...collected, format, folder });
    if (outcome.status === 'done') {
      run.state.set({ step: 'done', result: outcome.result });
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
  const run: Run = { deps, state, job: null };
  return {
    state,
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

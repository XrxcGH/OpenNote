// The export flow: choose what to export, the format, and the folder; export with progress and Cancel; show the
// summary. The host makes a new folder or file in the chosen folder, so nothing is overwritten.

import { checkBeforeOutput, reviewPages } from '../a11yCheck';
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
import { latexOptions, loadLatexChoices, saveLatexChoices } from './latex';
import type { LatexChoices } from './latex';

/** What Share as a file asks besides the folder. The password stays in memory and goes to the host only. */
export interface ShareChoices {
  password: string;
  confirm: string;
  history: boolean;
}

export const NO_SHARE_CHOICES: ShareChoices = { password: '', confirm: '', history: false };

export type ExportState =
  | {
      step: 'options';
      scope: ExportScope;
      format: ExportFormat;
      folder: string | null;
      error: IpcError | null;
      share?: ShareChoices;
      latex?: LatexChoices;
    }
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

/** The start of the `.tex` text a LaTeX export would write, as the options dialog shows it. */
export type LatexPreview =
  { status: 'idle' } | { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; error: IpcError };

/** How much of the `.tex` text the preview asks for. */
const PREVIEW_CHARS = 6000;
/** How long the preview waits after a choice, so typing an author name asks once. */
const PREVIEW_DELAY_MS = 350;

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
const ONE_FILE: readonly ExportFormat[] = ['docx', 'htmlSingle', 'pptx', 'xlsx', 'latex'];

export const folderOf = (path: string) => path.replace(/[\\/][^\\/]*$/, '');

export interface ExportFlow {
  readonly state: FlowState<ExportState>;
  /** The favorite folders and the copies sent before, when the host remembers them. */
  readonly extras: FlowState<SendExtras>;
  /** LaTeX: the start of the file the current choices would write. */
  readonly preview: FlowState<LatexPreview>;
  /** LaTeX: changes the options. */
  setLatex(choices: Partial<LatexChoices>): void;
  /** Uses a folder, such as a favorite one. */
  useFolder(path: string): void;
  /** Adds the chosen folder to the favorites, or takes it out. */
  toggleFavorite(): Promise<void>;
  /** Exports again over a copy that was sent before. */
  update(copy: SentCopy): Promise<void>;
  setScope(scope: ExportScope): void;
  setFormat(format: ExportFormat): void;
  /** Share as a file: the password, its confirmation, and whether to include page history. */
  setShare(choices: Partial<ShareChoices>): void;
  chooseFolder(): Promise<void>;
  start(): Promise<void>;
  cancel(): void;
  /** After an empty result: back to choosing what to export. */
  back(): void;
  running(): boolean;
  /** Listens for progress while the dialog is open. The returned function stops listening and cancels any job. */
  attach(): () => void;
}

/** What a PDF export prints before the host writes the bundle: the notebook's title and the sections it exports. */
export interface PdfPagesRequest {
  title: string;
  sections: { title: string; pages: { ui: string; title: string }[] }[];
}

/** Prints every page of a PDF export and hands the files to the host under the job's name (features/pdf/bundle). */
export type DrawPdf = (
  job: string,
  request: PdfPagesRequest,
  signal: AbortSignal,
  onPage: (done: number, total: number, title: string) => void,
) => Promise<unknown>;

export interface ExportFlowDeps {
  interop: InteropClient;
  notes: NotesService;
  target: ExportTarget;
  announce(text: string, politeness?: 'polite' | 'assertive'): void;
  /** Prints the pages of a PDF export. Without it, the host has no pages to write and reports each one. */
  drawPdf?: DrawPdf;
  /** The format the dialog starts with, such as `share` for Share as a file; Markdown when not given. */
  format?: ExportFormat;
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
  preview: FlowState<LatexPreview>;
  /** The timer that asks for the next preview, and the number of the latest ask, so an old answer is ignored. */
  previewTimer: ReturnType<typeof setTimeout> | null;
  previews: number;
  job: string | null;
  /** Stops the printing of a PDF export's pages. */
  abort: AbortController | null;
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
  const share = format === 'share' ? (options.share ?? NO_SHARE_CHOICES) : null;
  if (share && share.password !== share.confirm) {
    run.state.set({ ...options, error: { code: 'passwordMismatch', message: '' } });
    return;
  }
  const extra = share ? { history: share.history, ...(share.password ? { password: share.password } : {}) } : {};
  const latex = format === 'latex' ? (options.latex ?? loadLatexChoices()) : null;
  const name = newJobName('export');
  try {
    const collected = await collectRequest(notes, target, scope);
    if (latex) saveLatexChoices(latex);
    const latexRequest = latex ? { latex: await latexOptions(latex, String(target.notebook.id)) } : {};
    const ids = collected.sections.flatMap((section) => section.pages.map((page) => page.ui));
    if (pageCount(collected) > 0 && !(await checkBeforeOutput(ids, () => reviewPages(ids)))) {
      run.state.set({
        step: 'options',
        scope,
        format,
        folder,
        error: null,
        ...(share ? { share } : {}),
        ...kept(latex),
      });
      return;
    }
    if (pageCount(collected) === 0) {
      run.state.set({ step: 'empty', scope });
      return;
    }
    run.job = name;
    const shown = target.choices.find((choice) => choice.scope === scope)?.node.title ?? collected.title;
    run.state.set({ step: 'exporting', job: name, scope, format, folder, name: shown, progress: null });
    if (format === 'pdf' && run.deps.drawPdf && !(await printPages(run, name, collected))) {
      run.state.set({
        step: 'options',
        scope,
        format,
        folder,
        error: null,
        ...(share ? { share } : {}),
        ...kept(latex),
      });
      run.deps.announce(t('interop.export.canceled'));
      return;
    }
    const outcome = await interop.exportTo(name, {
      ...collected,
      format,
      folder,
      ...extra,
      ...latexRequest,
      ...(replace ? { replace } : {}),
    });
    if (outcome.status === 'done') {
      run.state.set({ step: 'done', result: outcome.result });
      await rememberCopy(run, scope, format, outcome.result.reveal);
      return;
    }
    run.state.set({ step: 'options', scope, format, folder, error: null, ...(share ? { share } : {}), ...kept(latex) });
    run.deps.announce(t('interop.export.canceled'));
  } catch (error) {
    run.state.set({
      step: 'options',
      scope,
      format,
      folder,
      error: asError(error),
      ...(share ? { share } : {}),
      ...kept(latex),
    });
  } finally {
    if (run.job === name) run.job = null;
  }
}

/** The LaTeX choices to keep in the options when the dialog goes back to them. */
const kept = (latex: LatexChoices | null) => (latex ? { latex } : {});

/** Asks the host for the preview a moment after the last choice. Only LaTeX has one. */
function schedulePreview(run: Run): void {
  if (run.previewTimer) clearTimeout(run.previewTimer);
  run.previewTimer = null;
  const current = optionsOf(run);
  const { interop, notes, target } = run.deps;
  if (!current || current.format !== 'latex' || !interop.latexPreview) {
    run.preview.set({ status: 'idle' });
    return;
  }
  const ask = interop.latexPreview.bind(interop);
  const { scope } = current;
  const choices = current.latex ?? loadLatexChoices();
  run.preview.set({ status: 'loading' });
  run.previewTimer = setTimeout(() => {
    run.previewTimer = null;
    run.previews += 1;
    const number = run.previews;
    void (async () => {
      try {
        const collected = await collectRequest(notes, target, scope);
        const latex = await latexOptions(choices, String(target.notebook.id));
        const text = await ask({ ...collected, format: 'latex', folder: '', latex }, PREVIEW_CHARS);
        if (number === run.previews) run.preview.set({ status: 'ready', text });
      } catch (error) {
        if (number === run.previews) run.preview.set({ status: 'error', error: asError(error) });
      }
    })();
  }, PREVIEW_DELAY_MS);
}

/** Prints the pages of a PDF export, showing each as it goes. False when the person canceled. */
async function printPages(run: Run, name: string, request: PdfPagesRequest): Promise<boolean> {
  const drawPdf = run.deps.drawPdf;
  if (!drawPdf) return true;
  const abort = new AbortController();
  run.abort = abort;
  try {
    await drawPdf(name, request, abort.signal, (done, total, current) => {
      const now = run.state.get();
      if (now.step === 'exporting' && now.job === name) {
        run.state.set({ ...now, progress: { phase: 'converting', unit: 'items', done, total, current } });
      }
    });
    return !abort.signal.aborted;
  } catch (error) {
    if (abort.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return false;
    throw error;
  } finally {
    if (run.abort === abort) run.abort = null;
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

/** Adds the folder to the favorites, or takes it out. */
async function toggleFavorite(run: Run): Promise<void> {
  const { interop } = run.deps;
  const folder = optionsOf(run)?.folder;
  if (!folder || !interop.more) return;
  const add = !run.extras.get().favorites.includes(folder);
  try {
    await interop.more('send_favorite', { path: folder, add });
    await loadExtras(run);
  } catch (error) {
    const current = optionsOf(run);
    if (current) run.state.set({ ...current, error: asError(error) });
  }
}

/** Exports again over a copy that was sent before. */
async function updateCopy(run: Run, copy: SentCopy): Promise<void> {
  const scope = run.deps.target.choices.find((choice) => choice.node.id === copy.node)?.scope;
  if (!scope) return;
  const folder = folderOf(copy.path);
  const options: Options = { step: 'options', scope, format: copy.format, folder, error: null };
  await exportNow(run, { ...options, folder }, copy.path);
}

/** Listens for progress. The returned function stops listening, drops the preview, and cancels any job. */
function attachRun(run: Run): () => void {
  const { interop } = run.deps;
  const stop = interop.onProgress((event) => onProgress(run, event));
  schedulePreview(run);
  return () => {
    stop();
    if (run.previewTimer) clearTimeout(run.previewTimer);
    run.previews += 1;
    run.abort?.abort();
    if (run.job) interop.cancel(run.job);
    run.job = null;
  };
}

/** The choices the options step makes: what to export, the format, and the options of Share and LaTeX. */
function choices(run: Run): Pick<ExportFlow, 'setScope' | 'setFormat' | 'setShare' | 'setLatex'> {
  const { state } = run;
  return {
    setScope(scope) {
      const current = optionsOf(run);
      if (!current) return;
      state.set({ ...current, scope });
      schedulePreview(run);
    },
    setFormat(format) {
      const current = optionsOf(run);
      if (!current) return;
      const latex = format === 'latex' ? (current.latex ?? loadLatexChoices()) : current.latex;
      state.set({ ...current, format, ...(latex ? { latex } : {}) });
      schedulePreview(run);
    },
    setShare(share) {
      const current = optionsOf(run);
      if (current) state.set({ ...current, share: { ...(current.share ?? NO_SHARE_CHOICES), ...share }, error: null });
    },
    setLatex(latex) {
      const current = optionsOf(run);
      if (!current) return;
      state.set({ ...current, latex: { ...(current.latex ?? loadLatexChoices()), ...latex }, error: null });
      schedulePreview(run);
    },
  };
}

export function createExportFlow(deps: ExportFlowDeps): ExportFlow {
  const state = createFlowState<ExportState>({
    step: 'options',
    scope: deps.target.initial,
    format: deps.format ?? 'markdown',
    folder: null,
    error: null,
    ...(deps.format === 'share' ? { share: NO_SHARE_CHOICES } : {}),
    ...(deps.format === 'latex' ? { latex: loadLatexChoices() } : {}),
  });
  const extras = createFlowState<SendExtras>({ favorites: [], copies: [] });
  const preview = createFlowState<LatexPreview>({ status: 'idle' });
  const run: Run = { deps, state, extras, preview, previewTimer: null, previews: 0, job: null, abort: null };
  void loadExtras(run);
  return {
    state,
    extras,
    preview,
    ...choices(run),
    useFolder(folder) {
      const current = optionsOf(run);
      if (current) state.set({ ...current, folder, error: null });
    },
    toggleFavorite: () => toggleFavorite(run),
    update: (copy) => updateCopy(run, copy),
    chooseFolder: () => chooseFolder(run),
    async start() {
      // Without a folder yet, Export asks for one first and goes on once the person has chosen.
      if (!optionsOf(run)?.folder) await chooseFolder(run);
      const current = optionsOf(run);
      if (current?.folder) await exportNow(run, { ...current, folder: current.folder });
    },
    cancel() {
      run.abort?.abort();
      if (run.job) deps.interop.cancel(run.job);
    },
    back() {
      const current = state.get();
      if (current.step === 'empty') {
        state.set({ step: 'options', scope: current.scope, format: 'markdown', folder: null, error: null });
      }
    },
    running: () => run.job !== null,
    attach: () => attachRun(run),
  };
}

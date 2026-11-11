// The studio window's state, apart from React: the project (source and store), the open tabs and their editors,
// the console, the problems, the run, and the tests. The window's components read it and call its actions; the
// studio's commands (Run, Stop, Restart, Problems) reach it through activeStudio().

import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { INSERT_EVENT } from '../../tools/flags';
import type {
  CodeProject,
  Diagnostic,
  ProjectLanguage,
  RunFile,
  RuntimeDiagnostic,
  RuntimeId,
  TestResult,
} from '../contracts';
import type { CodeEditor } from '../editor/create';
import { fileDownload } from '../project/exchange';
import { readProject, sortedFiles } from '../project/model';
import { createProjectStore } from '../project/store';
import type { Outcome, ProjectStore } from '../project/store';
import { loadSession, updateSession } from '../project/session';
import type { RunHandle, RunResult } from '../run/host';
import { noteText, statusLine } from '../run/summary';
import { ConsoleBuffer } from '../console/buffer';
import { stripAnsi } from '../console/ansi';
import { fromDiagnostic, fromRuntime } from '../problems/group';
import type { Problem } from '../problems/group';
import type { Example } from '../snippets/examples';
import { examplePatch, exampleTitle } from '../snippets/menu';
import { MAIN_FILES, RUNTIMES } from './languages';
import { rememberCurrent } from './relay';
import { orderFor, studioRunner } from './runner';
import type { ProjectSource } from './source';

export type PanelTab = 'console' | 'problems' | 'tests' | 'debug' | 'files';
export type RunState = 'idle' | 'loading' | 'running' | 'waiting';

export interface Cursor {
  line: number;
  column: number;
}

const shown: { studio: StudioController | null } = { studio: null };

/** The studio window that is open, for the studio's commands. */
export const activeStudio = (): StudioController | null => shown.studio;

export class StudioController {
  source: ProjectSource | null = null;
  store: ProjectStore | null = null;
  readonly console = new ConsoleBuffer();
  tabs: string[] = [];
  activeFile: string | null = null;
  panel: PanelTab = 'console';
  cursor: Cursor = { line: 1, column: 1 };
  runState: RunState = 'idle';
  runtimeVersion: string | null = null;
  lastResult: RunResult | null = null;
  runProblems: Problem[] = [];
  /** The checkers' problems by file (code:L10 publishes them; empty until then). */
  checkProblems = new Map<string, Problem[]>();
  written: RunFile[] = [];
  testResults: TestResult[] = [];
  /** Files whose text the page does not have yet. */
  readonly dirty = new Set<string>();
  inputPrompt: string | null = null;
  /** A message the files strip shows, such as a refused name. */
  notice = '';
  version = 0;

  private readonly editors = new Map<string, CodeEditor>();
  private readonly reveals = new Map<string, Cursor>();
  private readonly listeners = new Set<() => void>();
  private handle: RunHandle | null = null;
  private stopSource: (() => void) | null = null;
  private stopConsole: (() => void) | null = null;

  /** The window is on screen: the commands reach it, and the console redraws it. Returns the undo. */
  mount(): () => void {
    this.stopConsole = this.console.subscribe(() => this.changed());
    shown.studio = this;
    return () => this.dispose();
  }

  // --- React's view of the state.

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshot = (): number => this.version;

  changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  // --- The project.

  project(): CodeProject | null {
    return this.store?.project() ?? null;
  }

  /** The project's file IDs in tree order. */
  fileIds(): string[] {
    const project = this.project();
    return project ? sortedFiles(project.files).map(([id]) => id) : [];
  }

  pathOf(id: string): string {
    return this.project()?.files[id]?.path ?? id;
  }

  idOfPath(path: string): string | null {
    const project = this.project();
    if (!project) return null;
    return Object.entries(project.files).find(([, file]) => file.path === path)?.[0] ?? null;
  }

  open(source: ProjectSource): void {
    this.close();
    this.source = source;
    this.store = createProjectStore({
      data: source.data(),
      readOnly: source.readOnly(),
      patch: (data, fallback) => {
        source.patch(data, fallback);
        this.recheckDirty();
      },
    });
    this.stopSource = source.subscribe(() => this.fromSource());
    const session = source.kind === 'block' || source.kind === 'remote' ? loadSession(source.key) : null;
    const ids = this.fileIds();
    const project = this.project()!;
    this.tabs = (session?.openTabs ?? []).filter((id) => ids.includes(id));
    const first = session?.activeTab && ids.includes(session.activeTab) ? session.activeTab : project.main;
    if (ids.includes(first) && !this.tabs.includes(first)) this.tabs.push(first);
    this.activeFile = ids.includes(first) ? first : (ids[0] ?? null);
    this.console.clear();
    this.runProblems = [];
    this.testResults = [];
    this.written = [];
    if (source.kind !== 'scratch') rememberCurrent(source.key);
    this.changed();
  }

  close(): void {
    this.handle?.stop();
    this.store?.dispose();
    this.stopSource?.();
    this.source?.dispose();
    this.source = null;
    this.store = null;
    this.stopSource = null;
    this.dirty.clear();
  }

  dispose(): void {
    this.close();
    this.stopConsole?.();
    this.stopConsole = null;
    if (shown.studio === this) shown.studio = null;
  }

  /** Newer data from the page (undo, another device, the other window). */
  private fromSource(): void {
    const source = this.source;
    const store = this.store;
    if (!source || !store) return;
    store.update(source.data(), source.readOnly());
    const project = store.project();
    for (const [id, editor] of this.editors) {
      const file = project.files[id];
      if (file && !this.dirty.has(id) && editor.getText() !== file.text) editor.setText(file.text);
      editor.setReadOnly(!store.editable);
    }
    this.tabs = this.tabs.filter((id) => project.files[id]);
    if (this.activeFile && !project.files[this.activeFile]) this.activeFile = this.tabs[0] ?? project.main;
    this.recheckDirty();
  }

  private recheckDirty(): void {
    const sent = this.source ? readProject(this.source.data()) : null;
    for (const id of [...this.dirty]) {
      const editor = this.editors.get(id);
      if (!editor || !sent || sent.files[id]?.text === editor.getText()) this.dirty.delete(id);
    }
    this.changed();
  }

  private saveSession(): void {
    if (this.source && this.source.kind !== 'scratch') {
      updateSession(this.source.key, { openTabs: this.tabs, activeTab: this.activeFile });
    }
  }

  // --- Tabs and editors.

  openFile(id: string, at?: Cursor): void {
    if (!this.project()?.files[id]) return;
    if (!this.tabs.includes(id)) this.tabs = [...this.tabs, id];
    this.activeFile = id;
    if (at) {
      const editor = this.editors.get(id);
      if (editor) this.reveal(editor, at);
      else this.reveals.set(id, at);
    }
    this.saveSession();
    this.changed();
  }

  /** Opens the file a printed path names, at its line. */
  openPath(path: string, line: number, column = 1): void {
    const id = this.idOfPath(path);
    if (id) this.openFile(id, { line, column });
  }

  closeTab(id: string): void {
    const at = this.tabs.indexOf(id);
    if (at === -1) return;
    this.editors.get(id)?.destroy();
    this.editors.delete(id);
    this.tabs = this.tabs.filter((one) => one !== id);
    if (this.activeFile === id) this.activeFile = this.tabs[Math.min(at, this.tabs.length - 1)] ?? null;
    this.saveSession();
    this.changed();
  }

  attachEditor(id: string, editor: CodeEditor): void {
    this.editors.set(id, editor);
    editor.setReadOnly(!(this.store?.editable ?? false));
    const at = this.reveals.get(id);
    if (at) {
      this.reveals.delete(id);
      void editor.ready.then(() => this.reveal(editor, at));
    }
  }

  detachEditor(id: string): void {
    this.editors.delete(id);
  }

  editorOf(id: string): CodeEditor | null {
    return this.editors.get(id) ?? null;
  }

  private reveal(editor: CodeEditor, at: Cursor): void {
    const doc = editor.view.state.doc;
    const line = doc.line(Math.min(Math.max(1, at.line), doc.lines));
    const pos = Math.min(line.from + Math.max(0, at.column - 1), line.to);
    editor.view.dispatch({ selection: { anchor: pos }, scrollIntoView: true });
    editor.view.focus();
    this.setCursor({ line: line.number, column: pos - line.from + 1 });
  }

  setCursor(cursor: Cursor): void {
    if (cursor.line === this.cursor.line && cursor.column === this.cursor.column) return;
    this.cursor = cursor;
    this.changed();
  }

  /** The editor's text changed by typing. */
  edited(id: string, text: string): void {
    // A change from the page (setText) is already the store's text.
    if (this.project()?.files[id]?.text === text) return;
    const outcome = this.store?.editFile(id, text);
    if (outcome && !outcome.ok) this.say(outcome.message);
    this.dirty.add(id);
    this.changed();
  }

  // --- File actions.

  private say(text: string): void {
    this.notice = text;
    announce(text);
    this.changed();
  }

  private after<T>(outcome: Outcome<T> | undefined, done?: (value: T) => void): boolean {
    if (!outcome) return false;
    if (!outcome.ok) {
      this.say(outcome.message);
      return false;
    }
    this.notice = '';
    done?.(outcome.value);
    this.changed();
    return true;
  }

  newFile(path: string, text = ''): boolean {
    return this.after(this.store?.newFile(path, text), (id) => this.openFile(id));
  }

  renameFile(id: string, path: string): boolean {
    const ok = this.after(this.store?.renameFile(id, path));
    if (ok) {
      // The editor's language follows the new name.
      this.editors.get(id)?.destroy();
      this.editors.delete(id);
      this.changed();
    }
    return ok;
  }

  deleteFile(id: string): boolean {
    const ok = this.after(this.store?.deleteFile(id));
    if (ok) this.closeTab(id);
    return ok;
  }

  setMain(id: string): boolean {
    return this.after(this.store?.apply({ main: id }));
  }

  setRuntime(runtime: RuntimeId): boolean {
    return this.after(this.store?.apply({ runtime }));
  }

  setLanguage(language: ProjectLanguage): boolean {
    const runtime = language === 'python' && getSettings().code.pythonRuntime === 'full' ? 'python-full' : undefined;
    return this.after(this.store?.apply({ language, runtime: runtime ?? RUNTIMES[language]?.[0] ?? 'toolchain' }));
  }

  setStdin(stdin: string): boolean {
    return this.after(this.store?.apply({ stdin }));
  }

  /** The file as a download (the hand-over of code:L02's fileDownload). */
  async downloadFile(id: string): Promise<void> {
    const project = this.project();
    const file = project && fileDownload(project, id);
    if (!file) return;
    const { saveBytes } = await import('../../study');
    if (await saveBytes(file.name, file.name, file.bytes, 'text/plain')) {
      this.say(t('codeStudio.studio.files.downloaded', { name: file.name }));
    }
  }

  /** Adds an example (Snippets and examples): its files, its tests, and its entry as the main file. */
  insertExample(example: Example): boolean {
    const store = this.store;
    const project = this.project();
    if (!store || !project) return false;
    const { patch, entry } = examplePatch(project, example);
    const ok = this.after(store.apply(patch));
    if (!ok) return false;
    const now = this.project()!;
    for (const id of Object.keys(patch.files as object)) {
      const editor = this.editors.get(id);
      if (editor && editor.getText() !== now.files[id]?.text) editor.setText(now.files[id]!.text);
    }
    this.openFile(entry);
    this.say(t('codeStudio.studio.examples.inserted', { name: exampleTitle(example) }));
    return true;
  }

  // --- Running.

  run(test = false): void {
    const project = this.project();
    if (!project || this.handle) return;
    this.store?.flush();
    const cases = Object.values(project.tests).sort((a, b) => a.order - b.order);
    const order = orderFor(project, getSettings().code, test ? { cases, framework: true } : undefined);
    if (!order) {
      this.console.note(t('codeStudio.studio.console.noRuntime'));
      return;
    }
    this.panel = test ? 'tests' : 'console';
    this.runProblems = [];
    this.written = [];
    if (test) this.testResults = [];
    this.runState = 'loading';
    this.console.note(
      t(test ? 'codeStudio.studio.console.testing' : 'codeStudio.studio.console.running', { name: project.name }),
    );
    const handle = studioRunner().run(order, {
      onStarted: () => {
        this.runState = 'running';
        this.changed();
      },
      onOutput: (stream, text) => this.console.write(stream, text),
      onInputWanted: (prompt) => {
        this.runState = 'waiting';
        this.inputPrompt = prompt;
        this.changed();
      },
      onDiagnostics: (items: RuntimeDiagnostic[]) => {
        this.runProblems = items.map(fromRuntime);
        this.changed();
      },
      onTest: (result) => {
        this.testResults = [...this.testResults, result];
        this.changed();
      },
    });
    this.handle = handle;
    this.changed();
    void handle.done.then((result) => {
      if (this.handle !== handle) return;
      this.handle = null;
      this.lastResult = result;
      if (result.version) this.runtimeVersion = result.version;
      this.written = result.written;
      this.runState = 'idle';
      this.inputPrompt = null;
      const line =
        result.status === 'failed' && result.message === 'runtime'
          ? t('codeStudio.studio.console.runtimeMissing')
          : statusLine(result, order.limits);
      this.console.note(line);
      for (const note of result.notes) this.console.note(noteText(note));
      announce(line);
      this.changed();
    });
  }

  stop(): void {
    this.handle?.stop();
  }

  restart(): void {
    const handle = this.handle;
    if (!handle) return this.run();
    handle.stop();
    void handle.done.then(() => queueMicrotask(() => this.run()));
  }

  get running(): boolean {
    return this.handle !== null;
  }

  /** A line typed into the console's input line. */
  sendInput(text: string): void {
    if (!this.handle) return;
    this.console.echo(text);
    this.handle.input(text);
    this.runState = 'running';
    this.inputPrompt = null;
    this.changed();
  }

  endInput(): void {
    this.handle?.eof();
  }

  // --- Problems.

  /** A checker's diagnostics for one file (code:L10's publish). */
  setDiagnostics(file: string, items: readonly Diagnostic[]): void {
    const id = this.idOfPath(file);
    const text = id ? (this.project()?.files[id]?.text ?? '') : '';
    this.checkProblems.set(
      file,
      items.map((item) => fromDiagnostic(item, text)),
    );
    this.changed();
  }

  problems(): Problem[] {
    const level = getSettings().code.diagnostics;
    const all = [...this.runProblems, ...[...this.checkProblems.values()].flat()];
    if (level === 'errors') return all.filter((problem) => problem.severity === 'error');
    if (level === 'warnings')
      return all.filter((problem) => problem.severity === 'error' || problem.severity === 'warning');
    return all;
  }

  showPanel(panel: PanelTab): void {
    this.panel = panel;
    this.changed();
  }

  // --- Output.

  async copyOutput(): Promise<void> {
    try {
      await navigator.clipboard.writeText(stripAnsi(this.console.text()));
      this.say(t('codeStudio.studio.console.copied'));
    } catch {
      this.say(t('codeStudio.studio.console.copyFailed'));
    }
  }

  /** Puts the output on the page at the caret, as a code block, through the tools' insert event. */
  insertOutput(): void {
    const text = stripAnsi(this.console.text()).trim();
    if (!text) return;
    const html = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    // The page reads HTML; a div makes it a block of its own, after the block with the caret.
    const detail = { text: `<div><pre><code>${html}</code></pre></div>`, handled: false };
    window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail }));
    this.say(t(detail.handled ? 'codeStudio.studio.console.inserted' : 'codeStudio.studio.console.noPage'));
  }

  /** A new project's main file name. */
  static mainFile(language: ProjectLanguage): string {
    return MAIN_FILES[language];
  }
}

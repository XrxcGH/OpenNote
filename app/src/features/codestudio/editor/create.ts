// createCodeEditor: the one code editor of the studio and the code cells (ADR 0068, DESIGN 5). It joins the editing
// setup (setup.ts), the Tab and Escape rules and the Ctrl+Tab handling of DESIGN 5.3.1, suggestions (suggest.ts),
// the Accept button (button.ts), touch and pen, and the screen reader description.

import { closeCompletion, completionStatus } from '@codemirror/autocomplete';
import { indentUnit } from '@codemirror/language';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import type { CommandDef } from '../../../commands/types';
import { getSettings, settingsStore } from '../../../state/settings';
import { t } from '../../../strings/t';
import type { CompletionSource, Diagnostic, GhostSuggestion } from '../contracts';
import { runEditorAction } from './actions';
import { descriptionText } from './announce';
import { AcceptButtons } from './button';
import { replaceExternally } from './external';
import { ghostActions, setGhost } from './ghost';
import type { AcceptPart } from './ghost';
import { indentSpec, outdentSpec, resolveIndent, unitText } from './indent';
import type { EditorLanguage, IndentStyle } from './indent';
import { loadLanguage } from './languages';
import { setBreakpoints, setCurrentLine, setInlineValues } from './marks';
import type { InlineValue } from './marks';
import { showProblems } from './problems';
import { commandMatcher, completionExtension, editingExtensions, registryKeys } from './setup';
import { Suggestions } from './suggest';
import { codeTheme } from './theme';
import { clampZoom, installTouch } from './touch';
import type { CodeEditor, CodeEditorOptions, GhostSource } from './types';
import { getTabMovesFocus, registerCodeEditor } from './views';
import type { EditorAction } from './views';

export { ABANDON_MS, AUTO_PAUSE_MS } from './types';
export type { CodeEditor, CodeEditorOptions, GhostRequest, GhostSource } from './types';

let nextId = 0;
const NOT_DISARMING = new Set(['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta']);

class Controller implements CodeEditor {
  readonly root: HTMLElement;
  readonly view: EditorView;
  readonly ready: Promise<void>;
  readonly suggestions: Suggestions;
  private readonly buttons: AcceptButtons;
  private readonly description: HTMLElement;
  private readonly conf = {
    language: new Compartment(),
    indent: new Compartment(),
    readOnly: new Compartment(),
    wrap: new Compartment(),
    keys: new Compartment(),
    completion: new Compartment(),
  };
  private readonly stops: (() => void)[] = [];
  private matching: (event: KeyboardEvent) => CommandDef[] = commandMatcher();
  private sources: readonly CompletionSource[] = [];
  private lang: EditorLanguage;
  private ro: boolean;
  private wrap = false;
  private zoomValue = 1;
  private indentStyle: IndentStyle;
  /** Escape armed "Tab leaves the editor" for the next key press. */
  private armed = false;
  private destroyed = false;
  /** The settings onSettings last acted on. */
  private seen = getSettings();

  constructor(
    container: HTMLElement,
    private readonly options: CodeEditorOptions,
  ) {
    this.lang = options.language;
    this.ro = options.readOnly ?? false;
    this.indentStyle = this.resolveIndent(options.text);
    this.root = document.createElement('div');
    this.root.className = 'cm-code-editor';
    this.root.dataset.scope = 'codeEditor';
    this.root.style.position = 'relative';
    this.description = document.createElement('div');
    this.description.id = `code-editor-description-${++nextId}`;
    this.description.hidden = true;
    this.description.textContent = descriptionText();
    this.root.append(this.description);
    container.append(this.root);
    this.buttons = new AcceptButtons({
      root: this.root,
      accept: (part) => this.suggestions.acceptPart(part),
      dismiss: () => this.dismiss(),
    });
    this.view = new EditorView({
      parent: this.root,
      state: EditorState.create({ doc: options.text, extensions: this.extensions() }),
    });
    this.suggestions = new Suggestions({
      view: this.view,
      language: () => this.lang,
      readOnly: () => this.ro,
      hasFocus: () => this.root.contains(document.activeElement),
      ghostCleared: () => queueMicrotask(() => this.buttons.closeMenu()),
    });
    this.install();
    this.ready = this.setLanguage(options.language);
  }

  private extensions(): Extension {
    const { conf, options } = this;
    return [
      conf.keys.of(registryKeys(this.matching)),
      Prec.highest(
        keymap.of([
          { key: 'Tab', run: () => this.tab(false), shift: () => this.tab(true) },
          { key: 'Escape', run: () => this.escape() },
        ]),
      ),
      EditorView.domEventObservers({
        keydown: (event) => {
          if (!NOT_DISARMING.has(event.key)) this.armed = false;
        },
        // A click or tap in the text disarms too: the person is back to editing. CodeMirror keeps its own
        // two-second "Escape, then Tab leaves" state, which only keys clear, so it is cleared here as well.
        pointerdown: (_event, view) => this.disarm(view),
        mousedown: (_event, view) => this.disarm(view),
        blur: () => {
          this.armed = false;
          this.suggestions.cancel();
        },
      }),
      editingExtensions(options.onBreakpointToggle),
      conf.completion.of(this.completion()),
      ghostActions.of(this.buttons.actions),
      conf.language.of([]),
      conf.indent.of(this.indentExtension()),
      conf.readOnly.of(EditorState.readOnly.of(this.ro)),
      conf.wrap.of([]),
      EditorView.contentAttributes.of({
        'aria-label': options.label ?? t('codeStudio.editor.label'),
        'aria-describedby': this.description.id,
      }),
      EditorView.updateListener.of((update) => this.onUpdate(update)),
      codeTheme(),
      options.extensions ?? [],
    ];
  }

  private install(): void {
    // CodeMirror ignores a prevented event, observers included, so a key the app's dispatcher already ran is
    // stopped by a plain listener: the page and React ancestors never act on it a second time.
    const stopHandled = (event: KeyboardEvent) => {
      if (event.defaultPrevented && this.matching(event).length > 0) event.stopPropagation();
    };
    this.root.addEventListener('keydown', stopHandled);
    this.stops.push(
      () => this.root.removeEventListener('keydown', stopHandled),
      registerCodeEditor(this),
      settingsStore.subscribe(() => this.onSettings()),
      this.buttons.install(),
      installTouch(this.root, {
        getZoom: () => this.zoomValue,
        setZoom: (value) => this.setZoom(value),
        onPointer: (type) => this.buttons.pointer(type),
        onContextMenu: this.options.onContextMenu,
      }),
    );
  }

  // --- State the commands read.

  get content(): HTMLElement {
    return this.view.contentDOM;
  }

  get readOnly(): boolean {
    return this.ro;
  }

  get zoom(): number {
    return this.zoomValue;
  }

  get indent(): IndentStyle {
    return this.indentStyle;
  }

  hasGhost(): boolean {
    return this.suggestions.hasGhost();
  }

  suggestionShowing(): boolean {
    return this.suggestions.showing();
  }

  // --- Settings.

  private resolveIndent(text: string): IndentStyle {
    const style = resolveIndent(this.lang, text, getSettings().code.indent[this.lang]);
    return this.options.tabSize ? { ...style, size: this.options.tabSize } : style;
  }

  private indentExtension(): Extension {
    this.root?.style.setProperty('--code-indent-width', `${this.indentStyle.size}ch`);
    return [indentUnit.of(unitText(this.indentStyle)), EditorState.tabSize.of(this.indentStyle.size)];
  }

  private completion(): Extension {
    return completionExtension({
      sources: () => this.sources,
      language: () => this.lang,
      file: () => this.options.file ?? '',
    });
  }

  private onSettings(): void {
    // The store tells every change. Nothing to do when the settings object is the same, and the indentation is
    // detected again over the whole text only when the indent settings changed.
    const settings = getSettings();
    if (settings === this.seen) return;
    const indentChanged = settings.code.indent !== this.seen.code.indent;
    this.seen = settings;
    this.description.textContent = descriptionText();
    this.matching = commandMatcher();
    const effects = [
      this.conf.keys.reconfigure(registryKeys(this.matching)),
      this.conf.completion.reconfigure(this.completion()),
    ];
    const style = indentChanged ? this.resolveIndent(this.view.state.doc.toString()) : this.indentStyle;
    if (style.size !== this.indentStyle.size || style.tabs !== this.indentStyle.tabs) {
      this.indentStyle = style;
      effects.push(this.conf.indent.reconfigure(this.indentExtension()));
    }
    this.view.dispatch({ effects });
    this.buttons.refresh();
  }

  // --- Keys.

  /** Tab and Shift+Tab indent in every state. Armed by Escape, with Ctrl+M on, or read-only, they move focus. */
  private tab(back: boolean): boolean {
    if (this.armed || getTabMovesFocus() || this.ro) {
      this.armed = false;
      return false;
    }
    const view = this.view;
    if (completionStatus(view.state) !== null) closeCompletion(view);
    this.suggestions.cancel();
    const spec = back ? outdentSpec(view.state, this.indentStyle) : indentSpec(view.state, this.indentStyle);
    view.dispatch({ ...spec, effects: setGhost.of(null) });
    return true;
  }

  private disarm(view: EditorView): void {
    this.armed = false;
    view.setTabFocusMode(false);
  }

  /** Escape cancels a request. Otherwise it closes the list or ghost text, or stops a run, and arms "Tab leaves". */
  private escape(): boolean {
    if (this.buttons.menuOpen) {
      this.buttons.closeMenu();
      return true;
    }
    if (this.suggestions.requesting) {
      this.suggestions.cancel();
      return true;
    }
    this.armed = true;
    if (completionStatus(this.view.state) !== null) {
      closeCompletion(this.view);
      return true;
    }
    if (this.hasGhost()) {
      this.dismiss();
      return true;
    }
    return this.options.onEscape?.() ?? false;
  }

  private onUpdate(update: ViewUpdate): void {
    if (update.docChanged) this.options.onChange?.(update.state.doc.toString(), update);
    this.suggestions.update(update);
  }

  // --- The editor's interface.

  dismiss(): void {
    this.buttons.closeMenu();
    this.suggestions.dismiss();
  }

  toggleWrap(): void {
    this.wrap = !this.wrap;
    this.view.dispatch({ effects: this.conf.wrap.reconfigure(this.wrap ? EditorView.lineWrapping : []) });
  }

  zoomBy(step: number): void {
    this.setZoom(this.zoomValue + step);
  }

  private setZoom(value: number): void {
    this.zoomValue = clampZoom(value);
    this.root.style.setProperty('--code-zoom', String(this.zoomValue));
    this.view.requestMeasure();
  }

  run(action: EditorAction): boolean {
    return runEditorAction(this, action);
  }

  showGhost(suggestions: readonly GhostSuggestion[] | null): void {
    this.suggestions.show(suggestions);
  }

  acceptSuggestion(part: AcceptPart): string | null {
    return this.suggestions.acceptPart(part);
  }

  requestSuggestion(insert: boolean): Promise<boolean> {
    return this.suggestions.request(insert);
  }

  setSuggestionSource(source: GhostSource | null): void {
    this.suggestions.source = source;
  }

  setCompletionSources(sources: readonly CompletionSource[]): void {
    this.sources = sources;
  }

  getText(): string {
    return this.view.state.doc.toString();
  }

  setText(text: string): void {
    replaceExternally(this.view, text);
  }

  async setLanguage(language: EditorLanguage): Promise<void> {
    this.lang = language;
    const support = await loadLanguage(language);
    if (this.lang !== language || this.destroyed) return;
    this.indentStyle = this.resolveIndent(this.view.state.doc.toString());
    this.view.dispatch({
      effects: [this.conf.language.reconfigure(support), this.conf.indent.reconfigure(this.indentExtension())],
    });
  }

  setReadOnly(readOnly: boolean): void {
    this.ro = readOnly;
    this.view.dispatch({ effects: this.conf.readOnly.reconfigure(EditorState.readOnly.of(readOnly)) });
  }

  showProblems(items: readonly Diagnostic[]): void {
    showProblems(this.view, items);
  }

  setBreakpoints(lines: readonly number[]): void {
    this.view.dispatch({ effects: setBreakpoints.of(lines) });
  }

  setCurrentLine(line: number | null): void {
    this.view.dispatch({ effects: setCurrentLine.of(line) });
  }

  setInlineValues(values: readonly InlineValue[]): void {
    this.view.dispatch({ effects: setInlineValues.of(values) });
  }

  destroy(): void {
    this.destroyed = true;
    this.suggestions.destroy();
    this.stops.splice(0).forEach((stop) => stop());
    this.view.destroy();
    this.root.remove();
  }
}

/** Creates a code editor in `container`. */
export function createCodeEditor(container: HTMLElement, options: CodeEditorOptions): CodeEditor {
  return new Controller(container, options);
}

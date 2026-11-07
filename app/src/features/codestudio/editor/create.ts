// createCodeEditor: the one code editor of the studio and the code cells (ADR 0068, DESIGN 5). It sets up
// CodeMirror with the editing of DESIGN 5.3, the Tab and Escape rules and the Ctrl+Tab handling of 5.3.1, ghost text
// with its Accept button, the completion list host, problems, debugger marks, touch, pen, and the screen reader text.

import {
  acceptCompletion,
  autocompletion,
  clearSnippet,
  closeBrackets,
  closeBracketsKeymap,
  closeCompletion,
  completionKeymap,
  completionStatus,
  nextSnippetField,
  prevSnippetField,
  selectedCompletion,
  snippet,
  snippetKeymap,
  startCompletion,
} from '@codemirror/autocomplete';
import type { Completion, CompletionContext as CmContext, CompletionResult } from '@codemirror/autocomplete';
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  copyLineUp,
  defaultKeymap,
  deleteLine,
  history,
  historyKeymap,
  moveLineDown,
  moveLineUp,
  toggleBlockComment,
  toggleLineComment,
} from '@codemirror/commands';
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language';
import {
  gotoLine,
  highlightSelectionMatches,
  openSearchPanel,
  search,
  searchKeymap,
  selectNextOccurrence,
} from '@codemirror/search';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import {
  EditorView,
  crosshairCursor,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import type { ViewUpdate } from '@codemirror/view';
import { isEnabled } from '../../../app/flags';
import { chordMatches } from '../../../commands/chords';
import { keysFor } from '../../../commands/keymap';
import type { CommandContext, CommandDef } from '../../../commands/types';
import { getSettings, settingsStore } from '../../../state/settings';
import { t } from '../../../strings/t';
import type { CompletionSource, Diagnostic, GhostSuggestion } from '../contracts';
import { GETTING_AFTER_MS, SuggestionAnnouncer, acceptKeys, descriptionText } from './announce';
import { CODE_EDITOR_COMMANDS } from './commands';
import { replaceExternally } from './external';
import {
  acceptGhost,
  cycleGhost,
  ghostActions,
  ghostField,
  ghostOf,
  insertSuggestion,
  setGhost,
  setThinking,
  thinkingField,
} from './ghost';
import type { AcceptPart, GhostActions } from './ghost';
import { indentSpec, outdentSpec, resolveIndent, unitText } from './indent';
import type { EditorLanguage, IndentStyle } from './indent';
import { loadLanguage } from './languages';
import {
  debugGutter,
  expandSelection,
  markExtensions,
  setBreakpoints,
  setCurrentLine,
  setInlineValues,
  shrinkSelection,
} from './marks';
import type { InlineValue } from './marks';
import { goToProblem, problemExtensions, showProblems } from './problems';
import { codeTheme } from './theme';
import { ZOOM_STEP, clampZoom, installTouch } from './touch';
import { getTabMovesFocus, registerCodeEditor } from './views';
import type { CodeEditorHandle, EditorAction } from './views';

/** An on-demand request gives up after this long (the abandon limit of DESIGN 10.3). */
export const ABANDON_MS = 1500;
/** Automatic suggestions wait for this typing pause. */
export const AUTO_PAUSE_MS = 300;
const LONG_PRESS_MENU_ITEMS: readonly ('all' | 'word' | 'line' | 'dismiss')[] = ['all', 'word', 'line', 'dismiss'];

/** What a suggestion source reads. L12's pattern predictor and L13b's model answer it. */
export interface GhostRequest {
  language: EditorLanguage;
  text: string;
  pos: number;
  /** True when the person asked (Ctrl+Tab or Alt+\), not just paused. */
  explicit: boolean;
  signal: AbortSignal;
}

export type GhostSource = (
  request: GhostRequest,
) => GhostSuggestion | readonly GhostSuggestion[] | null | Promise<GhostSuggestion | readonly GhostSuggestion[] | null>;

export interface CodeEditorOptions {
  language: EditorLanguage;
  text: string;
  readOnly?: boolean;
  /** Forces the indent stop; otherwise the setting, the file's own style, or the language default. */
  tabSize?: number;
  onChange?: (text: string, update: ViewUpdate) => void;
  extensions?: Extension;
  /** The accessible name, such as the file name. Default "Code editor". */
  label?: string;
  /** The project path, for completion sources. */
  file?: string;
  /** Escape with nothing to close: a code cell stops its running program here and returns true. */
  onEscape?: () => boolean;
  /** A click in the breakpoint gutter. */
  onBreakpointToggle?: (line: number) => void;
  /** Long-press, right-click, or the pen's barrel button on the text: the studio's menu (Quick fix, Explain). */
  onContextMenu?: (event: MouseEvent) => void;
}

export interface CodeEditor extends CodeEditorHandle {
  readonly view: EditorView;
  /** Resolves when the language support has loaded. */
  readonly ready: Promise<void>;
  getText(): string;
  /** An outside change (page undo, sync): a minimal change outside the undo history. */
  setText(text: string): void;
  setLanguage(language: EditorLanguage): Promise<void>;
  setReadOnly(readOnly: boolean): void;
  /** The ghost text source (L12, L13b), or null for none. */
  setSuggestionSource(source: GhostSource | null): void;
  /** The completion list's sources (L12). */
  setCompletionSources(sources: readonly CompletionSource[]): void;
  showGhost(suggestions: readonly GhostSuggestion[] | null): void;
  acceptSuggestion(part: AcceptPart): string | null;
  /** Asks the source now; inserts the answer when `insert`, else shows it. Resolves whether something came. */
  requestSuggestion(insert: boolean): Promise<boolean>;
  showProblems(items: readonly Diagnostic[]): void;
  setBreakpoints(lines: readonly number[]): void;
  setCurrentLine(line: number | null): void;
  setInlineValues(values: readonly InlineValue[]): void;
  readonly zoom: number;
  readonly indent: IndentStyle;
  destroy(): void;
}

let nextId = 0;
// The registry's code.* commands read nothing from their context.
const NO_CONTEXT = {} as CommandContext;

function available(def: CommandDef): boolean {
  if (def.flag && !isEnabled(def.flag)) return false;
  return (!def.when || def.when(NO_CONTEXT)) && (!def.enabled || def.enabled(NO_CONTEXT));
}

/** The chords of every code.* command now, from keysFor, so a remap applies at once. */
function chordTable(): Map<string, CommandDef[]> {
  const table = new Map<string, CommandDef[]>();
  for (const def of CODE_EDITOR_COMMANDS)
    for (const key of keysFor(def.id)) table.set(key, [...(table.get(key) ?? []), def]);
  return table;
}

function list(value: GhostSuggestion | readonly GhostSuggestion[] | null | undefined): GhostSuggestion[] {
  if (!value) return [];
  return (Array.isArray(value) ? [...(value as readonly GhostSuggestion[])] : [value as GhostSuggestion]).filter(
    (s) => s.text,
  );
}

class Controller implements CodeEditor {
  readonly root: HTMLElement;
  readonly view: EditorView;
  readonly ready: Promise<void>;
  private readonly description: HTMLElement;
  private readonly language = new Compartment();
  private readonly indentConf = new Compartment();
  private readonly readOnlyConf = new Compartment();
  private readonly wrapConf = new Compartment();
  private readonly keysConf = new Compartment();
  private readonly completionConf = new Compartment();
  private readonly announcer = new SuggestionAnnouncer();
  private readonly stops: (() => void)[] = [];
  private lang: EditorLanguage;
  private ro: boolean;
  private wrap = false;
  private zoomValue = 1;
  private indentStyle: IndentStyle;
  private source: GhostSource | null = null;
  private sources: readonly CompletionSource[] = [];
  private armed = false;
  private pending: { controller: AbortController; timers: ReturnType<typeof setTimeout>[] } | null = null;
  private autoTimer: ReturnType<typeof setTimeout> | undefined;
  private autoController: AbortController | null = null;
  private lastPointer: string | null = null;
  private hovering = false;
  private menu: HTMLElement | null = null;

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

    const actions: GhostActions = {
      accept: (part) => this.acceptAndSay(part),
      dismiss: () => this.dismiss(),
      openMenu: (anchor) => this.openMenu(anchor),
      buttonVisible: () => this.buttonVisible(),
      buttonLabel: () => t('codeStudio.editor.acceptButton'),
      buttonTooltip: () => {
        const keys = acceptKeys();
        return keys ? t('codeStudio.editor.acceptTooltip', { keys }) : t('codeStudio.editor.acceptButton');
      },
    };

    this.view = new EditorView({
      parent: this.root,
      state: EditorState.create({
        doc: options.text,
        extensions: [
          this.keysConf.of(this.registryKeys()),
          Prec.highest(
            keymap.of([
              { key: 'Tab', run: () => this.tab(false), shift: () => this.tab(true) },
              { key: 'Escape', run: () => this.escape() },
            ]),
          ),
          EditorView.domEventObservers({
            keydown: (event) => this.observeKey(event),
            blur: () => this.onBlur(),
          }),
          lineNumbers(),
          highlightActiveLineGutter(),
          foldGutter(),
          codeFolding(),
          debugGutter(options.onBreakpointToggle),
          problemExtensions,
          history({ newGroupDelay: 500 }),
          drawSelection(),
          EditorState.allowMultipleSelections.of(true),
          EditorView.clickAddsSelectionRange.of((event) => event.altKey && !event.shiftKey),
          rectangularSelection({ eventFilter: (event) => event.altKey && event.shiftKey }),
          crosshairCursor({ key: 'Alt' }),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          search({ top: true }),
          this.completionConf.of(this.completion()),
          snippetKeymap.of([
            { key: 'Enter', run: nextSnippetField },
            { key: 'Shift-Enter', run: prevSnippetField },
            { key: 'Escape', run: clearSnippet },
          ]),
          ghostField,
          thinkingField,
          ghostActions.of(actions),
          markExtensions,
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
          ]),
          this.language.of([]),
          this.indentConf.of(this.indentExtension()),
          this.readOnlyConf.of(EditorState.readOnly.of(this.ro)),
          this.wrapConf.of([]),
          EditorView.contentAttributes.of({
            'aria-label': options.label ?? t('codeStudio.editor.label'),
            'aria-describedby': this.description.id,
          }),
          EditorView.updateListener.of((update) => this.onUpdate(update)),
          codeTheme(),
          options.extensions ?? [],
        ],
      }),
    });

    this.stops.push(
      registerCodeEditor(this),
      settingsStore.subscribe(() => this.onSettings()),
      installTouch(this.root, {
        getZoom: () => this.zoomValue,
        setZoom: (value) => this.setZoom(value),
        onPointer: (type) => {
          this.lastPointer = type;
          this.refreshButton();
        },
        onContextMenu: options.onContextMenu,
      }),
    );
    this.root.addEventListener('keydown', this.stopHandled);
    this.stops.push(() => this.root.removeEventListener('keydown', this.stopHandled));
    const over = (event: PointerEvent) => this.hover(event, true);
    const out = (event: PointerEvent) => this.hover(event, false);
    this.root.addEventListener('pointerover', over);
    this.root.addEventListener('pointerout', out);
    this.stops.push(() => {
      this.root.removeEventListener('pointerover', over);
      this.root.removeEventListener('pointerout', out);
    });
    this.ready = this.setLanguage(options.language);
  }

  // --- State the commands read.

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
    return ghostOf(this.view.state) !== null;
  }

  suggestionShowing(): boolean {
    return (
      this.hasGhost() ||
      (completionStatus(this.view.state) === 'active' && selectedCompletion(this.view.state) !== null)
    );
  }

  // --- Setup pieces.

  private resolveIndent(text: string): IndentStyle {
    const setting = getSettings().code.indent[this.lang];
    const style = resolveIndent(this.lang, text, setting);
    return this.options.tabSize ? { ...style, size: this.options.tabSize } : style;
  }

  private indentExtension(): Extension {
    this.root?.style.setProperty('--code-indent-width', `${this.indentStyle.size}ch`);
    return [indentUnit.of(unitText(this.indentStyle)), EditorState.tabSize.of(this.indentStyle.size)];
  }

  private completion(): Extension {
    return autocompletion({
      override: [(context) => this.complete(context)],
      activateOnTyping: getSettings().code.completionList,
      defaultKeymap: false,
      icons: false,
    });
  }

  private async complete(context: CmContext): Promise<CompletionResult | null> {
    if (this.sources.length === 0) return null;
    const word = context.matchBefore(/[\p{L}\p{N}_$]*/u);
    const from = word?.from ?? context.pos;
    const before = from > 0 ? context.state.sliceDoc(from - 1, from) : '';
    if (!context.explicit && from === context.pos && before !== '.') return null;
    const request = {
      language: this.lang as never,
      file: this.options.file ?? '',
      text: context.state.doc.toString(),
      pos: context.pos,
      word: { from, to: context.pos, text: context.state.sliceDoc(from, context.pos) },
      explicit: context.explicit,
    };
    const lists = await Promise.all(
      this.sources.map((source) => Promise.resolve(source.complete(request)).catch(() => [])),
    );
    const items = lists.flat().sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    const options: Completion[] = items.map((item, index) => ({
      label: item.label,
      detail: item.detail,
      type: item.kind,
      boost: Math.max(-99, 99 - index),
      apply: item.snippet ? snippet(item.insert ?? item.label) : (item.insert ?? item.label),
    }));
    return options.length ? { from, options } : null;
  }

  /**
   * The code.* commands' chords as CodeMirror sees them. A press the app's dispatcher did not run (no dispatcher, or
   * a chord such as Ctrl+Right that stays with text fields) runs the command here once and stops.
   */
  private registryKeys(): Extension {
    this.chords = chordTable();
    return Prec.highest(
      EditorView.domEventHandlers({
        keydown: (event) => {
          if (event.defaultPrevented) return false;
          const def = this.matching(event).find(available);
          if (!def) return false;
          event.preventDefault();
          event.stopPropagation();
          void def.run(NO_CONTEXT, undefined);
          return true;
        },
      }),
    );
  }

  private chords = new Map<string, CommandDef[]>();

  private matching(event: KeyboardEvent): CommandDef[] {
    return chordMatches(event).flatMap(({ chord }) => this.chords.get(chord) ?? []);
  }

  /**
   * A press the dispatcher already ran only stops here, so the page and React ancestors never act on it a second
   * time. CodeMirror ignores prevented events entirely, observers included, so this is a plain listener.
   */
  private stopHandled = (event: KeyboardEvent): void => {
    if (event.defaultPrevented && this.matching(event).length > 0) event.stopPropagation();
  };

  private onSettings(): void {
    this.description.textContent = descriptionText();
    const style = this.resolveIndent(this.view.state.doc.toString());
    const effects = [
      this.keysConf.reconfigure(this.registryKeys()),
      this.completionConf.reconfigure(this.completion()),
    ];
    if (style.size !== this.indentStyle.size || style.tabs !== this.indentStyle.tabs) {
      this.indentStyle = style;
      effects.push(this.indentConf.reconfigure(this.indentExtension()));
    }
    this.view.dispatch({ effects });
    this.refreshButton();
  }

  // --- Keys.

  private observeKey(event: KeyboardEvent): void {
    if (['Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) return;
    this.armed = false;
  }

  /** Tab and Shift+Tab indent in every state; armed (Escape first), Ctrl+M, or read-only, they move focus. */
  private tab(back: boolean): boolean {
    if (this.armed || getTabMovesFocus() || this.ro) {
      this.armed = false;
      return false;
    }
    const view = this.view;
    if (completionStatus(view.state) !== null) closeCompletion(view);
    this.cancelRequest();
    const spec = back ? outdentSpec(view.state, this.indentStyle) : indentSpec(view.state, this.indentStyle);
    view.dispatch({ ...spec, effects: setGhost.of(null) });
    return true;
  }

  /** Escape: cancel a request; else close the list or ghost text; else stop a run; and arm "Tab leaves". */
  private escape(): boolean {
    if (this.menu) {
      this.closeMenu();
      return true;
    }
    if (this.pending) {
      this.cancelRequest();
      return true;
    }
    this.armed = true;
    const view = this.view;
    if (completionStatus(view.state) !== null) {
      closeCompletion(view);
      return true;
    }
    if (this.hasGhost()) {
      this.dismiss();
      return true;
    }
    return this.options.onEscape?.() ?? false;
  }

  private onBlur(): void {
    this.armed = false;
    this.cancelRequest();
  }

  // --- Suggestions.

  private acceptAndSay(part: AcceptPart): string | null {
    const text = acceptGhost(this.view, part);
    if (text) this.announcer.inserted(text);
    this.closeMenu();
    return text;
  }

  acceptSuggestion(part: AcceptPart): string | null {
    return this.acceptAndSay(part);
  }

  /** Ctrl+Tab: accept what shows, else ask and insert on arrival. */
  private accept(): boolean {
    const view = this.view;
    if (completionStatus(view.state) === 'active' && selectedCompletion(view.state)) return acceptCompletion(view);
    if (this.hasGhost()) return this.acceptAndSay('all') !== null;
    if (getSettings().code.suggestions === 'off' || this.ro) return false;
    void this.requestSuggestion(true);
    return true;
  }

  private dismiss(): void {
    this.closeMenu();
    if (this.hasGhost()) this.view.dispatch({ effects: setGhost.of(null) });
  }

  showGhost(suggestions: readonly GhostSuggestion[] | null): void {
    const shown = suggestions ? list(suggestions) : [];
    this.view.dispatch({ effects: setGhost.of(shown.length ? shown : null) });
    if (shown[0]) this.announcer.suggestion(shown[0].text);
  }

  setSuggestionSource(source: GhostSource | null): void {
    this.source = source;
  }

  setCompletionSources(sources: readonly CompletionSource[]): void {
    this.sources = sources;
  }

  private request(explicit: boolean, signal: AbortSignal) {
    const state = this.view.state;
    return { language: this.lang, text: state.doc.toString(), pos: state.selection.main.head, explicit, signal };
  }

  async requestSuggestion(insert: boolean): Promise<boolean> {
    this.cancelRequest();
    const view = this.view;
    const source = this.source;
    const start = view.state;
    const pos = start.selection.main.head;
    if (!source || !start.selection.main.empty) {
      this.announcer.none();
      return false;
    }
    const controller = new AbortController();
    const pending = { controller, timers: [] as ReturnType<typeof setTimeout>[] };
    this.pending = pending;
    view.dispatch({ effects: setThinking.of(pos) });
    pending.timers.push(setTimeout(() => this.announcer.getting(), GETTING_AFTER_MS));
    const answer = await Promise.race([
      Promise.resolve()
        .then(() => source(this.request(true, controller.signal)))
        .catch(() => null),
      new Promise<null>((resolve) => pending.timers.push(setTimeout(() => resolve(null), ABANDON_MS))),
    ]);
    if (this.pending !== pending) return false;
    this.cancelRequest();
    const found = list(answer).filter((s) => s.from === pos);
    const still = view.state.doc === start.doc && view.state.selection.eq(start.selection) && this.hasFocus();
    if (!still) return false;
    if (!found[0]) {
      this.announcer.none();
      return false;
    }
    if (insert) {
      insertSuggestion(view, found[0]);
      this.announcer.inserted(found[0].text);
    } else {
      this.showGhost(found);
    }
    return true;
  }

  private cancelRequest(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.timers.forEach(clearTimeout);
    pending.controller.abort();
    if (this.view.state.field(thinkingField) !== null) {
      // Not while an update runs: the thinking field clears itself on any edit or caret move.
      queueMicrotask(() => {
        if (this.view.state.field(thinkingField) !== null) this.view.dispatch({ effects: setThinking.of(null) });
      });
    }
  }

  private hasFocus(): boolean {
    return this.root.contains(document.activeElement);
  }

  private scheduleAuto(): void {
    clearTimeout(this.autoTimer);
    this.autoController?.abort();
    const mode = getSettings().code.suggestions;
    if (!this.source || this.ro || (mode !== 'automaticRules' && mode !== 'automaticModel')) return;
    this.autoTimer = setTimeout(() => void this.autoSuggest(), AUTO_PAUSE_MS);
  }

  private async autoSuggest(): Promise<void> {
    const source = this.source;
    const start = this.view.state;
    if (!source || !start.selection.main.empty || this.pending || completionStatus(start) !== null) return;
    const controller = new AbortController();
    this.autoController = controller;
    const answer = await Promise.resolve()
      .then(() => source(this.request(false, controller.signal)))
      .catch(() => null);
    if (
      controller.signal.aborted ||
      this.view.state.doc !== start.doc ||
      !this.view.state.selection.eq(start.selection)
    )
      return;
    const found = list(answer).filter((s) => s.from === start.selection.main.head);
    if (found.length) this.showGhost(found);
  }

  private onUpdate(update: ViewUpdate): void {
    if (update.docChanged) {
      this.options.onChange?.(update.state.doc.toString(), update);
      const typed = update.transactions.some(
        (tr) => (tr.isUserEvent('input') || tr.isUserEvent('delete')) && !tr.isUserEvent('input.complete'),
      );
      if (typed) this.scheduleAuto();
    }
    if (this.pending && (update.docChanged || update.selectionSet)) this.cancelRequest();
    const had = update.startState.field(ghostField, false);
    if (had && !ghostOf(update.state)) {
      this.announcer.cleared();
      if (this.menu) queueMicrotask(() => this.closeMenu());
    }
  }

  // --- The Accept button and its menu.

  private buttonVisible(): boolean {
    const mode = getSettings().code.acceptButton;
    if (mode === 'always') return true;
    if (mode === 'never') return false;
    return this.lastPointer === 'touch' || this.lastPointer === 'pen' || this.hovering;
  }

  private refreshButton(): void {
    const visible = this.buttonVisible();
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('.cm-ghost-accept')) button.hidden = !visible;
  }

  private hover(event: PointerEvent, entering: boolean): void {
    if (event.pointerType !== 'mouse' || !(event.target instanceof Element) || !event.target.closest('.cm-ghost'))
      return;
    const related = event.relatedTarget instanceof Element ? event.relatedTarget.closest('.cm-ghost') : null;
    if (!entering && related) return;
    this.hovering = entering;
    this.refreshButton();
  }

  private openMenu(anchor: HTMLElement): void {
    this.closeMenu();
    const menu = document.createElement('div');
    menu.className = 'cm-ghost-menu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', t('codeStudio.editor.menu.label'));
    const labels = {
      all: t('codeStudio.editor.menu.accept'),
      word: t('codeStudio.editor.menu.acceptWord'),
      line: t('codeStudio.editor.menu.acceptLine'),
      dismiss: t('codeStudio.editor.menu.dismiss'),
    };
    for (const item of LONG_PRESS_MENU_ITEMS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.tabIndex = -1;
      button.setAttribute('role', 'menuitem');
      button.textContent = labels[item];
      button.dataset.item = item;
      button.addEventListener('pointerdown', (event) => event.preventDefault());
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => (item === 'dismiss' ? this.dismiss() : this.acceptAndSay(item)));
      menu.append(button);
    }
    const box = this.root.getBoundingClientRect();
    const at = anchor.getBoundingClientRect();
    menu.style.left = `${at.left - box.left}px`;
    menu.style.top = `${at.bottom - box.top}px`;
    this.root.append(menu);
    this.menu = menu;
    const outside = (event: PointerEvent) => {
      if (!menu.contains(event.target as Node)) this.closeMenu();
    };
    document.addEventListener('pointerdown', outside, true);
    this.menuStop = () => document.removeEventListener('pointerdown', outside, true);
  }

  private menuStop: (() => void) | null = null;

  private closeMenu(): void {
    this.menuStop?.();
    this.menuStop = null;
    this.menu?.remove();
    this.menu = null;
  }

  // --- Everything else.

  private setZoom(value: number): void {
    this.zoomValue = clampZoom(value);
    this.root.style.setProperty('--code-zoom', String(this.zoomValue));
    this.view.requestMeasure();
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
      effects: [this.language.reconfigure(support), this.indentConf.reconfigure(this.indentExtension())],
    });
  }

  setReadOnly(readOnly: boolean): void {
    this.ro = readOnly;
    this.view.dispatch({ effects: this.readOnlyConf.reconfigure(EditorState.readOnly.of(readOnly)) });
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

  run(action: EditorAction): boolean {
    const view = this.view;
    switch (action) {
      case 'completion.accept':
        return this.accept();
      case 'completion.request':
        void this.requestSuggestion(false);
        return true;
      case 'completion.list':
        return startCompletion(view);
      case 'completion.acceptWord':
        return this.acceptAndSay('word') !== null;
      case 'completion.acceptLine':
        return this.acceptAndSay('line') !== null;
      case 'completion.dismiss':
        if (completionStatus(view.state) !== null) closeCompletion(view);
        this.dismiss();
        return true;
      case 'completion.next':
      case 'completion.previous': {
        if (!this.hasGhost()) return false;
        view.dispatch({ effects: cycleGhost.of(action === 'completion.next' ? 1 : -1) });
        const ghost = ghostOf(view.state);
        if (ghost) this.announcer.suggestion(ghost.text);
        return true;
      }
      case 'addNextOccurrence':
        return selectNextOccurrence(view);
      case 'toggleLineComment':
        return toggleLineComment(view);
      case 'toggleBlockComment':
        return toggleBlockComment(view);
      case 'moveLineUp':
        return moveLineUp(view);
      case 'moveLineDown':
        return moveLineDown(view);
      case 'copyLineUp':
        return copyLineUp(view);
      case 'copyLineDown':
        return copyLineDown(view);
      case 'deleteLine':
        return deleteLine(view);
      case 'cursorAbove':
        return addCursorAbove(view);
      case 'cursorBelow':
        return addCursorBelow(view);
      case 'find':
        return openSearchPanel(view);
      case 'replace': {
        openSearchPanel(view);
        view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.focus();
        return true;
      }
      case 'goToLine':
        return gotoLine(view);
      case 'expandSelection':
        return expandSelection(view);
      case 'shrinkSelection':
        return shrinkSelection(view);
      case 'wordWrap':
        this.wrap = !this.wrap;
        view.dispatch({ effects: this.wrapConf.reconfigure(this.wrap ? EditorView.lineWrapping : []) });
        return true;
      case 'zoomIn':
        this.setZoom(this.zoomValue + ZOOM_STEP);
        return true;
      case 'zoomOut':
        this.setZoom(this.zoomValue - ZOOM_STEP);
        return true;
      case 'problemNext':
        return goToProblem(view, 1);
      case 'problemPrevious':
        return goToProblem(view, -1);
    }
  }

  private destroyed = false;

  destroy(): void {
    this.destroyed = true;
    this.cancelRequest();
    clearTimeout(this.autoTimer);
    this.autoController?.abort();
    this.closeMenu();
    this.stops.splice(0).forEach((stop) => stop());
    this.view.destroy();
    this.root.remove();
  }
}

/** Creates a code editor in `container`. */
export function createCodeEditor(container: HTMLElement, options: CodeEditorOptions): CodeEditor {
  return new Controller(container, options);
}

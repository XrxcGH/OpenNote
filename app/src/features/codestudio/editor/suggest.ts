// Suggestions in one editor (DESIGN 5.3.1): showing ghost text, accepting it, asking the source on demand with a
// thinking indicator, and asking it automatically after a typing pause. Each step tells screen readers.

import { acceptCompletion, completionStatus, selectedCompletion } from '@codemirror/autocomplete';
import type { EditorView, ViewUpdate } from '@codemirror/view';
import { getSettings } from '../../../state/settings';
import type { GhostSuggestion } from '../contracts';
import { GETTING_AFTER_MS, SuggestionAnnouncer } from './announce';
import { acceptGhost, ghostField, ghostOf, insertSuggestion, setGhost, setThinking, thinkingField } from './ghost';
import type { AcceptPart } from './ghost';
import type { EditorLanguage } from './indent';
import { ABANDON_MS, AUTO_PAUSE_MS } from './types';
import type { GhostAnswer, GhostRequest, GhostSource } from './types';

/** What the suggestions read from their editor. */
export interface SuggestionHost {
  readonly view: EditorView;
  language(): EditorLanguage;
  readOnly(): boolean;
  hasFocus(): boolean;
  /** Called when the ghost text goes away, so its menu closes. */
  ghostCleared(): void;
}

function list(value: GhostAnswer | undefined): GhostSuggestion[] {
  if (!value) return [];
  const all: readonly GhostSuggestion[] = Array.isArray(value) ? value : [value as GhostSuggestion];
  return all.filter((suggestion) => suggestion.text);
}

type Timer = ReturnType<typeof setTimeout>;

export class Suggestions {
  readonly announcer = new SuggestionAnnouncer();
  source: GhostSource | null = null;
  private pending: { controller: AbortController; timers: Timer[] } | null = null;
  private autoTimer: Timer | undefined;
  private autoController: AbortController | null = null;

  constructor(private readonly host: SuggestionHost) {}

  get requesting(): boolean {
    return this.pending !== null;
  }

  hasGhost(): boolean {
    return ghostOf(this.host.view.state) !== null;
  }

  /** Ghost text, or the completion list with an item selected. */
  showing(): boolean {
    const state = this.host.view.state;
    return this.hasGhost() || (completionStatus(state) === 'active' && selectedCompletion(state) !== null);
  }

  acceptPart(part: AcceptPart): string | null {
    const text = acceptGhost(this.host.view, part);
    if (text) this.announcer.inserted(text);
    return text;
  }

  /** Ctrl+Tab: accept what shows; else ask, and insert what arrives in time. */
  accept(): boolean {
    const view = this.host.view;
    if (completionStatus(view.state) === 'active' && selectedCompletion(view.state)) return acceptCompletion(view);
    if (this.hasGhost()) return this.acceptPart('all') !== null;
    if (getSettings().code.suggestions === 'off' || this.host.readOnly()) return false;
    void this.request(true);
    return true;
  }

  dismiss(): void {
    if (this.hasGhost()) this.host.view.dispatch({ effects: setGhost.of(null) });
  }

  show(suggestions: readonly GhostSuggestion[] | null): void {
    const shown = suggestions ? list(suggestions) : [];
    this.host.view.dispatch({ effects: setGhost.of(shown.length ? shown : null) });
    if (shown[0]) this.announcer.suggestion(shown[0].text);
  }

  private requestFor(explicit: boolean, signal: AbortSignal): GhostRequest {
    const state = this.host.view.state;
    return {
      language: this.host.language(),
      text: state.doc.toString(),
      pos: state.selection.main.head,
      explicit,
      signal,
    };
  }

  private ask(source: GhostSource, explicit: boolean, signal: AbortSignal): Promise<GhostAnswer> {
    return Promise.resolve()
      .then(() => source(this.requestFor(explicit, signal)))
      .catch(() => null);
  }

  /** Asks the source now: inserts the answer, or shows it, if it comes within 1.5 s and nothing moved. */
  async request(insert: boolean): Promise<boolean> {
    this.cancel();
    const { view } = this.host;
    const source = this.source;
    const start = view.state;
    const pos = start.selection.main.head;
    if (!source || !start.selection.main.empty) {
      this.announcer.none();
      return false;
    }
    const pending = { controller: new AbortController(), timers: [] as Timer[] };
    this.pending = pending;
    view.dispatch({ effects: setThinking.of(pos) });
    pending.timers.push(setTimeout(() => this.announcer.getting(), GETTING_AFTER_MS));
    const abandon = new Promise<null>((resolve) => pending.timers.push(setTimeout(() => resolve(null), ABANDON_MS)));
    const answer = await Promise.race([this.ask(source, true, pending.controller.signal), abandon]);
    if (this.pending !== pending) return false;
    this.cancel();
    const found = list(answer).filter((suggestion) => suggestion.from === pos);
    const still = view.state.doc === start.doc && view.state.selection.eq(start.selection) && this.host.hasFocus();
    if (!still) return false;
    if (!found[0]) {
      this.announcer.none();
      return false;
    }
    if (!insert) {
      this.show(found);
      return true;
    }
    insertSuggestion(view, found[0]);
    this.announcer.inserted(found[0].text);
    return true;
  }

  /** Stops an on-demand request: typing, a caret move, Escape, or leaving the editor. */
  cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    pending.timers.forEach(clearTimeout);
    pending.controller.abort();
    const { view } = this.host;
    if (view.state.field(thinkingField) === null) return;
    // Not while an update runs: the thinking field clears itself on any edit or caret move.
    queueMicrotask(() => {
      if (view.state.field(thinkingField) !== null) view.dispatch({ effects: setThinking.of(null) });
    });
  }

  private scheduleAuto(): void {
    clearTimeout(this.autoTimer);
    this.autoController?.abort();
    const mode = getSettings().code.suggestions;
    if (!this.source || this.host.readOnly() || (mode !== 'automaticRules' && mode !== 'automaticModel')) return;
    this.autoTimer = setTimeout(() => void this.autoSuggest(), AUTO_PAUSE_MS);
  }

  private async autoSuggest(): Promise<void> {
    const source = this.source;
    const { view } = this.host;
    const start = view.state;
    if (!source || !start.selection.main.empty || this.pending || completionStatus(start) !== null) return;
    const controller = new AbortController();
    this.autoController = controller;
    const answer = await this.ask(source, false, controller.signal);
    const moved = view.state.doc !== start.doc || !view.state.selection.eq(start.selection);
    if (controller.signal.aborted || moved) return;
    const found = list(answer).filter((suggestion) => suggestion.from === start.selection.main.head);
    if (found.length) this.show(found);
  }

  /** Every editor update: typing schedules an automatic suggestion; an edit or caret move cancels a request. */
  update(update: ViewUpdate): void {
    const typed = update.transactions.some(
      (tr) => (tr.isUserEvent('input') || tr.isUserEvent('delete')) && !tr.isUserEvent('input.complete'),
    );
    if (update.docChanged && typed) this.scheduleAuto();
    if (this.pending && (update.docChanged || update.selectionSet)) this.cancel();
    if (update.startState.field(ghostField, false) && !ghostOf(update.state)) {
      this.announcer.cleared();
      this.host.ghostCleared();
    }
  }

  destroy(): void {
    this.cancel();
    clearTimeout(this.autoTimer);
    this.autoController?.abort();
  }
}

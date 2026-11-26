// Ghost text: a gray continuation at the caret that Ctrl+Tab accepts (DESIGN 5.3.1 and 10). The text is an
// aria-hidden decoration, so it is never document text. At its end sits the Accept button for mouse, touch, and
// pen. Accepting inserts the text as one undo step. Any edit or caret move hides the ghost text.

import { isolateHistory } from '@codemirror/commands';
import { Facet, StateEffect, StateField } from '@codemirror/state';
import type { EditorState } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import type { GhostSuggestion } from '../contracts';
import { BARREL_MENU_MS } from './touch';

export interface GhostState {
  /** Where the text goes. */
  from: number;
  text: string;
  /** Every alternative the source gave; Alt+] and Alt+[ move between them. */
  alternatives: readonly GhostSuggestion[];
  index: number;
}

/** Shows suggestions (the first one), or hides the ghost text with null. */
export const setGhost = StateEffect.define<readonly GhostSuggestion[] | null>();
/** Moves to the next (+1) or previous (-1) alternative. */
export const cycleGhost = StateEffect.define<1 | -1>();
/** Shows the thinking indicator at a position, or hides it with null. */
export const setThinking = StateEffect.define<number | null>();

/** What the Accept button and its menu do. The editor provides them. */
export interface GhostActions {
  accept(part: AcceptPart): void;
  dismiss(): void;
  openMenu(anchor: HTMLElement): void;
  /** Whether the Accept button shows now. */
  buttonVisible(): boolean;
  buttonLabel(): string;
  buttonTooltip(): string;
}

export type AcceptPart = 'all' | 'word' | 'line';

export const ghostActions = Facet.define<GhostActions, GhostActions | null>({
  combine: (values) => values[0] ?? null,
});

function stateFor(list: readonly GhostSuggestion[], index: number): GhostState | null {
  const pick = list[index];
  return pick && pick.text ? { from: pick.from, text: pick.text, alternatives: list, index } : null;
}

class GhostWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: GhostWidget): boolean {
    return other.text === this.text;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span');
    wrap.className = 'cm-ghost';
    const text = document.createElement('span');
    text.className = 'cm-ghost-text';
    text.setAttribute('aria-hidden', 'true');
    text.textContent = this.text;
    wrap.append(text);
    const actions = view.state.facet(ghostActions);
    if (actions) wrap.append(acceptButton(actions));
    return wrap;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const LONG_PRESS_MS = 500;

/** The Accept button: tabindex -1, so Tab keeps indenting; pointerdown keeps the caret, selection, and focus. */
function acceptButton(actions: GhostActions): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-ghost-accept';
  button.tabIndex = -1;
  button.setAttribute('aria-label', actions.buttonLabel());
  button.title = actions.buttonTooltip();
  button.textContent = '↵';
  button.hidden = !actions.buttonVisible();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let menuOpened = false;
  // A secondary or barrel press opens the menu on pointerdown; the browser's contextmenu for that press follows.
  let pressOpenedAt = -Infinity;
  const stopTimer = () => clearTimeout(timer);
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    menuOpened = false;
    // The pen's barrel button arrives as the secondary button.
    if (event.button === 2 || (event.pointerType === 'pen' && (event.buttons & 2) !== 0)) {
      menuOpened = true;
      pressOpenedAt = Date.now();
      actions.openMenu(button);
      return;
    }
    if (event.pointerType !== 'mouse') {
      timer = setTimeout(() => {
        menuOpened = true;
        actions.openMenu(button);
      }, LONG_PRESS_MS);
    }
  });
  button.addEventListener('pointerup', stopTimer);
  button.addEventListener('pointercancel', stopTimer);
  button.addEventListener('pointerleave', stopTimer);
  button.addEventListener('mousedown', (event) => event.preventDefault());
  button.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    stopTimer();
    // The same press already opened the menu: keep it open instead of closing and reopening it.
    if (Date.now() - pressOpenedAt <= BARREL_MENU_MS) {
      pressOpenedAt = -Infinity;
      return;
    }
    menuOpened = true;
    actions.openMenu(button);
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    stopTimer();
    if (menuOpened) {
      menuOpened = false;
      return;
    }
    actions.accept('all');
  });
  return button;
}

class ThinkingWidget extends WidgetType {
  eq(): boolean {
    return true;
  }

  toDOM(): HTMLElement {
    const span = document.createElement('span');
    span.className = 'cm-thinking';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = '…';
    return span;
  }
}

export const ghostField = StateField.define<GhostState | null>({
  create: () => null,
  update(value, tr) {
    let next = value;
    let set = false;
    for (const effect of tr.effects) {
      if (effect.is(setGhost)) {
        next = effect.value ? stateFor(effect.value, 0) : null;
        set = true;
      } else if (effect.is(cycleGhost) && next) {
        const count = next.alternatives.length;
        next = stateFor(next.alternatives, (next.index + effect.value + count) % count) ?? next;
        set = true;
      }
    }
    if (!set && next && (tr.docChanged || tr.selection)) return null;
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (ghost) =>
      ghost
        ? Decoration.set([Decoration.widget({ widget: new GhostWidget(ghost.text), side: 1 }).range(ghost.from)])
        : Decoration.none,
    ),
});

export const thinkingField = StateField.define<number | null>({
  create: () => null,
  update(value, tr) {
    let next = value === null ? null : tr.changes.mapPos(value);
    for (const effect of tr.effects) if (effect.is(setThinking)) next = effect.value;
    return next;
  },
  provide: (field) =>
    EditorView.decorations.from(field, (pos) =>
      pos === null
        ? Decoration.none
        : Decoration.set([Decoration.widget({ widget: new ThinkingWidget(), side: 1 }).range(pos)]),
    ),
});

export function ghostOf(state: EditorState): GhostState | null {
  return state.field(ghostField, false) ?? null;
}

/** The next word of a suggestion, with the space before it: VS Code's "accept next word". */
export function nextWord(text: string): string {
  const match = /^\s*(?:[\p{L}\p{N}_]+|[^\p{L}\p{N}_\s]+)/u.exec(text);
  return match ? match[0] : text.slice(0, 1);
}

/** The rest of the suggestion's first line (or its next line when it starts with a line break). */
export function nextLine(text: string): string {
  const start = text.startsWith('\n') ? 1 : 0;
  const end = text.indexOf('\n', start);
  return end === -1 ? text : text.slice(0, end);
}

/** A position a change can use: a whole number from 0 to the document's length. */
export function inDocument(pos: number, length: number): boolean {
  return Number.isInteger(pos) && pos >= 0 && pos <= length;
}

/** Inserts all or part of the ghost text as one undo step. Returns the inserted text, or null without ghost text. */
export function acceptGhost(view: EditorView, part: AcceptPart): string | null {
  const ghost = ghostOf(view.state);
  if (!ghost || !inDocument(ghost.from, view.state.doc.length)) return null;
  const piece = part === 'all' ? ghost.text : part === 'word' ? nextWord(ghost.text) : nextLine(ghost.text);
  const rest = ghost.text.slice(piece.length);
  const at = ghost.from + piece.length;
  const current = ghost.alternatives[ghost.index];
  view.dispatch({
    changes: { from: ghost.from, insert: piece },
    selection: { anchor: at },
    effects: setGhost.of(rest && current ? [{ ...current, from: at, text: rest }] : null),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
  return piece;
}

/** Inserts text at the caret as one undo step: an on-demand suggestion that arrived in time. */
export function insertSuggestion(view: EditorView, suggestion: GhostSuggestion): void {
  const at = suggestion.from + suggestion.text.length;
  view.dispatch({
    changes: { from: suggestion.from, insert: suggestion.text },
    selection: { anchor: at },
    effects: setGhost.of(null),
    annotations: isolateHistory.of('full'),
    userEvent: 'input.complete',
    scrollIntoView: true,
  });
}

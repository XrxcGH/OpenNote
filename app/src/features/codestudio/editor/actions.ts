// What each code.* command does in the focused editor (DESIGN 5.3). The editing actions are CodeMirror's commands;
// the suggestion actions, word wrap, and zoom go to the editor itself.

import { closeCompletion, completionStatus, startCompletion } from '@codemirror/autocomplete';
import {
  addCursorAbove,
  addCursorBelow,
  copyLineDown,
  copyLineUp,
  deleteLine,
  moveLineDown,
  moveLineUp,
  toggleBlockComment,
  toggleLineComment,
} from '@codemirror/commands';
import { gotoLine, openSearchPanel, selectNextOccurrence } from '@codemirror/search';
import type { EditorView } from '@codemirror/view';
import { cycleGhost, ghostOf } from './ghost';
import { expandSelection, shrinkSelection } from './marks';
import { goToProblem } from './problems';
import type { Suggestions } from './suggest';
import { ZOOM_STEP } from './touch';
import type { EditorAction } from './views';

export interface ActionHost {
  readonly view: EditorView;
  readonly suggestions: Suggestions;
  dismiss(): void;
  toggleWrap(): void;
  zoomBy(step: number): void;
}

type Run = (view: EditorView) => boolean;

const VIEW_ACTIONS: Partial<Record<EditorAction, Run>> = {
  'completion.list': startCompletion,
  addNextOccurrence: selectNextOccurrence,
  toggleLineComment,
  toggleBlockComment,
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  deleteLine,
  cursorAbove: addCursorAbove,
  cursorBelow: addCursorBelow,
  find: openSearchPanel,
  replace: (view) => {
    openSearchPanel(view);
    view.dom.querySelector<HTMLInputElement>('.cm-search input[name="replace"]')?.focus();
    return true;
  },
  goToLine: gotoLine,
  expandSelection,
  shrinkSelection,
  problemNext: (view) => goToProblem(view, 1),
  problemPrevious: (view) => goToProblem(view, -1),
};

function cycle(host: ActionHost, direction: 1 | -1): boolean {
  if (!host.suggestions.hasGhost()) return false;
  host.view.dispatch({ effects: cycleGhost.of(direction) });
  const ghost = ghostOf(host.view.state);
  if (ghost) host.suggestions.announcer.suggestion(ghost.text);
  return true;
}

function runSuggestionAction(host: ActionHost, action: EditorAction): boolean | null {
  const { suggestions, view } = host;
  switch (action) {
    case 'completion.accept':
      return suggestions.accept();
    case 'completion.request':
      void suggestions.request(false);
      return true;
    case 'completion.acceptWord':
      return suggestions.acceptPart('word') !== null;
    case 'completion.acceptLine':
      return suggestions.acceptPart('line') !== null;
    case 'completion.dismiss':
      if (completionStatus(view.state) !== null) closeCompletion(view);
      host.dismiss();
      return true;
    case 'completion.next':
      return cycle(host, 1);
    case 'completion.previous':
      return cycle(host, -1);
    default:
      return null;
  }
}

/** Runs one action. Returns whether it did something. */
export function runEditorAction(host: ActionHost, action: EditorAction): boolean {
  const viewAction = VIEW_ACTIONS[action];
  if (viewAction) return viewAction(host.view);
  if (action === 'wordWrap') host.toggleWrap();
  else if (action === 'zoomIn') host.zoomBy(ZOOM_STEP);
  else if (action === 'zoomOut') host.zoomBy(-ZOOM_STEP);
  else return runSuggestionAction(host, action) ?? false;
  return true;
}

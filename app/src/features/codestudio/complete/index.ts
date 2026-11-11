// Completion without a model (DESIGN 10.2, lane code:L12): the ranked list, snippets with fields, pattern ghost text,
// and explicit requests. It works on every build. The studio window (code:L04) and code cells (code:L19) call
// attachCompletion on each editor they create, through loadCompletion in features/codestudio/index.ts.

import { pickedCompletion } from '@codemirror/autocomplete';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';
import { StateEffect } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { CompletionSource } from '../contracts';
import type { CodeEditor, GhostSource } from '../editor';
import { suggest } from './ghost';
import { rank, rememberPick } from './rank';
import type { RankInput } from './rank';
import type { SyntaxTree } from './scope';

export { contextAt, suggest } from './ghost';
export type { GhostQuery } from './ghost';
export { AUTO_THRESHOLD, EXPLICIT_THRESHOLD, predict } from './pattern';
export type { Prediction } from './pattern';
export { forgetPicks, LEAD_MARGIN, leader, matchScore, PRIOR, rank, rememberPick } from './rank';
export type { RankInput } from './rank';
export { SNIPPETS } from './snippets';

export interface CompletionOptions {
  /** The text of the other open files, for the words source. */
  otherTexts?: () => readonly string[];
}

/** Waits at most this long for the parser before ranking without the tree. */
const PARSE_BUDGET_MS = 15;

/** The editor's syntax tree, when it describes `text`. */
function treeOf(editor: CodeEditor, text: string): SyntaxTree | null {
  const state = editor.view.state;
  if (state.doc.length !== text.length) return null;
  return ensureSyntaxTree(state, state.doc.length, PARSE_BUDGET_MS) ?? syntaxTree(state);
}

/** The ranked list as one completion source: the sources merge before scoring, so a name shows once. */
export function rankedSource(input: (text: string) => RankInput): CompletionSource {
  return { id: 'scope', prior: 0, complete: (context) => rank(context, input(context.text)) };
}

/** The pattern predictor and explicit requests as the editor's ghost text source. */
export function patternSource(input: (text: string) => RankInput): GhostSource {
  return (request) => suggest(request, input(request.text));
}

/** Gives an editor the ranked list and pattern ghost text, and remembers accepted items. Returns an undo. */
export function attachCompletion(editor: CodeEditor, options: CompletionOptions = {}): () => void {
  const input = (text: string): RankInput => ({ tree: treeOf(editor, text), otherTexts: options.otherTexts?.() });
  editor.setCompletionSources([rankedSource(input)]);
  editor.setSuggestionSource(patternSource(input));
  let attached = true;
  editor.view.dispatch({
    effects: StateEffect.appendConfig.of(
      EditorView.updateListener.of((update) => {
        if (!attached) return;
        for (const tr of update.transactions) {
          const picked = tr.annotation(pickedCompletion);
          if (picked) rememberPick(picked.label);
        }
      }),
    ),
  });
  return () => {
    attached = false;
    editor.setCompletionSources([]);
    editor.setSuggestionSource(null);
  };
}

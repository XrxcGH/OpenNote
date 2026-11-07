// The editor side of review (ADR 0086), added to every text editor through the editor extension registry behind
// text.review: the suggesting-mode plugin, and "Insertion by Sam" spoken when the caret enters a suggestion (text
// DESIGN.md 12). This file also loads the marks' styles and keeps the markup view on the root element.
// registrations/review.ts loads it right after start-up.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState } from '@tiptap/pm/state';
import { editorExtensions } from '../../editor/extensions/kit';
import type { EditorHost } from '../../editor/host';
import { t } from '../../strings/t';
import { newId } from '../../editor/ids';
import { findSuggestion, stageSuggestion } from './model';
import { SUGGESTION_MARKS, kindOfMark, stamp } from './records';
import { authorName, reviewPrefs, suggesting } from './state';
import { trackChanges } from './suggest';
import type { Tracker } from './suggest';
import './review.module.css';

/** The tracker the editors use: the person's name, new IDs, and the page models' records. */
export const pageTracker: Tracker = {
  author: authorName,
  newId: () => newId(),
  now: () => stamp(),
  authorOf: (id) => findSuggestion(id)?.author ?? null,
  stage: stageSuggestion,
};

const key = new PluginKey('opennoteSuggesting');

/** The suggesting-mode plugin: while `on()` holds, each edit becomes a suggestion. */
export function suggestingPlugin(on: () => boolean, tracker: Tracker): Plugin {
  return new Plugin({
    key,
    appendTransaction: (transactions, old, state) => (on() ? trackChanges(transactions, old, state, tracker) : null),
  });
}

const SAY = { ins: 'textReview.insertionBy', del: 'textReview.deletionBy', fmt: 'textReview.formatBy' } as const;

/** What to say about the suggestion at a caret, with its ID, or null when the caret is in none. */
export function suggestionAtCaret(state: EditorState): { id: string; text: string } | null {
  const { selection } = state;
  if (!selection.empty) return null;
  const node = selection.$from.nodeAfter ?? selection.$from.nodeBefore;
  for (const mark of node?.marks ?? []) {
    const kind = kindOfMark(mark.type.name);
    if (!kind) continue;
    const id = String(mark.attrs[SUGGESTION_MARKS[kind].key]);
    const author = findSuggestion(id)?.author ?? t('textReview.unknownAuthor');
    return { id, text: t(SAY[kind], { author }) };
  }
  return null;
}

/** Speaks a suggestion's kind and author once when the caret moves into it. */
function announcePlugin(host: EditorHost): Plugin {
  let last: string | null = null;
  return new Plugin({
    key: new PluginKey('opennoteSuggestionAnnounce'),
    view: () => ({
      update(view, previous) {
        if (previous.selection.eq(view.state.selection) || !view.hasFocus()) return;
        const found = suggestionAtCaret(view.state);
        if (found && found.id !== last) host.announce(found.text);
        last = found?.id ?? null;
      },
    }),
  });
}

const suggestingExtension = (host: EditorHost) =>
  Extension.create({
    name: 'opennoteSuggesting',
    addProseMirrorPlugins() {
      return [suggestingPlugin(() => suggesting.get() && this.editor.isEditable, pageTracker), announcePlugin(host)];
    },
  });

if (!editorExtensions.get('text.review')) {
  editorExtensions.register({
    id: 'text.review',
    order: 420,
    flag: 'text.review',
    kinds: ['text'],
    create: suggestingExtension,
  });
}

function showMarkup(): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.reviewMarkup = reviewPrefs.get().markup;
}
showMarkup();
reviewPrefs.subscribe(showMarkup);

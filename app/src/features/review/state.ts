// The Review tab's state (ADR 0086): whether suggesting mode is on, which markup view shows, and the name that new
// comments and suggestions carry. The name is a display name the person types; it is never an account ID and is
// never sent anywhere but into the page. It is kept on this device. This file loads at start-up, so it imports
// nothing from the editor.
import { createStore } from '../../state/store';
import { t } from '../../strings/t';

/** Simple shows the text with changes made and a bar beside changed lines; All shows every mark; None hides them. */
export type Markup = 'simple' | 'all' | 'none';

/** The longest author name a record holds (spec: 1 to 100 characters). */
export const MAX_AUTHOR = 100;

/** A name that fits a record: trimmed, 1 to 100 characters, or the fallback. */
export function cleanAuthor(name: string, fallback: string): string {
  const trimmed = [...name.trim()].slice(0, MAX_AUTHOR).join('');
  return trimmed.length > 0 ? trimmed : fallback;
}

export const MARKUPS: readonly Markup[] = ['simple', 'all', 'none'];

export interface ReviewPrefs {
  author: string;
  markup: Markup;
}

const KEY = 'opennote.review';

function load(): ReviewPrefs {
  const prefs: ReviewPrefs = { author: '', markup: 'all' };
  try {
    const saved: unknown = JSON.parse(globalThis.localStorage?.getItem(KEY) ?? 'null');
    if (saved && typeof saved === 'object') {
      const { author, markup } = saved as Record<string, unknown>;
      if (typeof author === 'string') prefs.author = [...author].slice(0, MAX_AUTHOR).join('');
      if (MARKUPS.includes(markup as Markup)) prefs.markup = markup as Markup;
    }
  } catch {
    // Defaults hold.
  }
  return prefs;
}

export const reviewPrefs = createStore<ReviewPrefs>(load(), 'review prefs');

/** Whether typing and deleting make suggestions. It starts off in every window, as in Word. */
export const suggesting = createStore<boolean>(false, 'suggesting mode');

export function setReviewPrefs(change: Partial<ReviewPrefs>): void {
  const next = { ...reviewPrefs.get(), ...change };
  reviewPrefs.set(next);
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    // The choice holds for this session.
  }
}

/** The name new comments and suggestions carry: the person's display name, or "Author" until they set one. */
export function authorName(): string {
  return cleanAuthor(reviewPrefs.get().author, t('textReview.defaultAuthor'));
}

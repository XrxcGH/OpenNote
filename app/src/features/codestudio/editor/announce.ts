// What screen readers hear about suggestions (DESIGN 5.3.1). The ghost text itself is aria-hidden, so it is never
// read as document text. A new suggestion is announced once, at most one every 2 s, unless the setting is off. The
// chord always comes from keysFor, so a remapped Accept is read correctly.

import { formatChord, keysFor } from '../../../commands/keymap';
import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { announce } from '../../../ui/announce';

/** At most one suggestion announcement in this time. */
export const ANNOUNCE_GAP_MS = 2000;
/** An on-demand request says "Getting a suggestion" only when it takes longer than this. */
export const GETTING_AFTER_MS = 500;

/** The Accept chord as people read it, such as "Ctrl+Tab", or null when it has none. */
export function acceptKeys(): string | null {
  const [first] = keysFor('code.completion.accept');
  return first ? formatChord(first) : null;
}

/** "Suggestion: print(total). Ctrl+Tab to accept.", with "and N more lines" for a longer one. */
export function suggestionText(text: string): string {
  const [first = '', ...rest] = text.split('\n');
  const line = first.trim();
  const keys = acceptKeys();
  const more = rest.length;
  if (more > 0) {
    return keys
      ? t('codeStudio.editor.say.suggestionLines', { text: line, more, keys })
      : t('codeStudio.editor.say.suggestionLinesNoChord', { text: line, more });
  }
  return keys
    ? t('codeStudio.editor.say.suggestion', { text: line, keys })
    : t('codeStudio.editor.say.suggestionNoChord', { text: line });
}

/** "Inserted: print(total)", or "Inserted 4 lines". */
export function insertedText(text: string): string {
  const lines = text.split('\n').length;
  return lines > 1
    ? t('codeStudio.editor.say.insertedLines', { count: lines })
    : t('codeStudio.editor.say.inserted', { text: text.trim() });
}

/** The editor's description, with the current chords. */
export function descriptionText(): string {
  const keys = acceptKeys();
  return keys ? t('codeStudio.editor.description', { accept: keys }) : t('codeStudio.editor.descriptionNoChord');
}

/** One editor's announcements. The clock is injectable for tests. */
export class SuggestionAnnouncer {
  private lastAt = -Infinity;
  private lastText = '';

  constructor(private readonly now: () => number = () => Date.now()) {}

  /** A new suggestion shows. */
  suggestion(text: string): boolean {
    if (!getSettings().code.announceSuggestions || !text.trim() || text === this.lastText) return false;
    const at = this.now();
    if (at - this.lastAt < ANNOUNCE_GAP_MS) return false;
    this.lastAt = at;
    this.lastText = text;
    announce(suggestionText(text));
    return true;
  }

  /** The suggestion went away, so the same text may be announced again later. */
  cleared(): void {
    this.lastText = '';
  }

  inserted(text: string): void {
    announce(insertedText(text));
  }

  getting(): void {
    announce(t('codeStudio.editor.say.getting'));
  }

  none(): void {
    announce(t('codeStudio.editor.say.none'));
  }
}

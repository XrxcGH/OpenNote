// Two actions that the text keys reach but other lanes own: breaking the page (the page layout) and focusing the style
// box (the styles gallery). Each owner sets its handler while it is shown, and clears it when it goes. With no handler
// the key's command is unavailable, so Ctrl+Enter still toggles a task's check and the key passes on. Light on
// purpose, because the start-up registrations read it.
import { createStore } from '../../state/store';

export interface TextSeams {
  /** Whether a page break can go at the caret now: a paginated page, and the caret not in a task item. */
  canBreakPage(): boolean;
  /** Puts a page break after the paragraph at the caret. */
  breakPage(): void;
  /** Moves focus to the style box, or opens the style gallery when the box is not shown. */
  focusStyleBox(): void;
}

export const textSeams = createStore<Partial<TextSeams>>({}, 'text key seams');

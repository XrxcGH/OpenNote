// Starts what a page with a recording needs to watch (Phase 9): the editor that has the caret, for time stamps on
// typed text; Alt+click, to hear a word; and the highlight that follows playback. Calling it again, as when another
// page is shown, points the watching at the new page's editors.
import { followPlayback } from './highlight';
import { installTapToHear, watchEditors } from './stamps';

let stopEditors: (() => void) | null = null;
let stopHighlight: (() => void) | null = null;

export function activate(): void {
  stopEditors?.();
  stopEditors = watchEditors();
  installTapToHear();
  stopHighlight ??= followPlayback();
}

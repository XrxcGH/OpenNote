// Transaction meta keys that every Phase 4 package agrees on (PLAN.md section 3.6, owned by WP0). The text sync
// reads them to decide what a transaction is: typing, a command, an automatic change, or a change from the core.

/** A change that came from the core (undo, redo, or another window). The sync never sends it back. */
export const META_REMOTE = 'opennote.remote';
/** A command's transaction. The sync flushes pending typing first and sends it as its own step. */
export const META_COMMAND = 'opennote.command';
/** An automatic change, such as AutoCorrect or an input rule, with `{ from, to, text }`: its own undo step. */
export const META_AUTO_CHANGE = 'opennote.autoChange';
/** A decoration-only transaction, such as spelling or code highlighting. The sync ignores it. */
export const META_HIGHLIGHT = 'opennote.highlight';

/** The value of META_AUTO_CHANGE: the range the change replaced and the text it typed there. */
export interface AutoChangeMeta {
  from: number;
  to: number;
  text: string;
}

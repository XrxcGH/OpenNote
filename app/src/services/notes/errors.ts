// Contract between the shell (Phase 2) and storage (Phase 3). Changes need approval from both phase owners.
//
// Every notes service method rejects only with NotesError. The message is for logs and is never shown; the
// interface picks its own words from the code and the reason.

export type NotesErrorCode =
  'not-found' | 'invalid-name' | 'invalid-move' | 'read-only' | 'conflict' | 'unavailable' | 'io';

/**
 * Phase 3's storage names folders by id or rewrites unsafe names, so it reports only 'empty' and 'too-long'. The
 * other reasons stay for storage that names files after titles, and the shell has words for each.
 */
export type InvalidNameReason = 'empty' | 'too-long' | 'reserved' | 'characters' | 'trailing-dot-or-space';

export class NotesError extends Error {
  readonly code: NotesErrorCode;
  /** Set with 'invalid-name'. */
  readonly reason?: InvalidNameReason;
  /** For example the reserved name "CON". */
  readonly detail?: string;

  constructor(code: NotesErrorCode, message: string, reason?: InvalidNameReason, detail?: string) {
    super(message);
    this.name = 'NotesError';
    this.code = code;
    this.reason = reason;
    this.detail = detail;
  }
}

export function isNotesError(error: unknown, code?: NotesErrorCode): error is NotesError {
  return error instanceof NotesError && (code === undefined || error.code === code);
}

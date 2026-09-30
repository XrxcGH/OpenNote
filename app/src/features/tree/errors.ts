// Words for notes service errors, in BRAND.md's voice: what happened, why when it's known, and what to do next.

import { isNotesError } from '../../services/notes';
import type { NotesError } from '../../services/notes';
import { NOTES_LIMITS } from '../../services/notes';
import { t } from '../../strings/t';
import { showToast } from '../../ui';

/** The toast text for a change to `title` that the service refused. */
export function describeError(error: unknown, title: string): string {
  switch (isNotesError(error) ? error.code : 'io') {
    case 'invalid-move':
      return t('tree.errors.invalidMove', { title });
    case 'read-only':
      return t('tree.errors.readOnly', { title });
    case 'unavailable':
      return t('tree.errors.unavailable');
    case 'not-found':
      return t('tree.errors.notFound', { title });
    default:
      return t('tree.errors.other', { title });
  }
}

export function toastError(error: unknown, title: string): void {
  showToast({ message: describeError(error, title), tone: 'danger' });
}

/** The message under a rename field for a refused name, or null when the error isn't about the name. */
export function nameError(error: unknown): string | null {
  if (!isNotesError(error, 'invalid-name')) return null;
  const { reason, detail } = error as NotesError;
  switch (reason) {
    case 'empty':
      return t('tree.rename.empty');
    case 'too-long':
      return t('tree.rename.tooLong', { max: NOTES_LIMITS.titleLength });
    case 'reserved':
      return t('tree.rename.reserved', { name: detail ?? '' });
    case 'characters':
      return t('tree.rename.characters');
    default:
      return t('tree.rename.trailingDotOrSpace');
  }
}

/** Checks a name before it reaches the service, so the field answers at once. */
export function checkName(draft: string): string | null {
  const length = [...draft.trim()].length;
  if (length === 0) return t('tree.rename.empty');
  if (length > NOTES_LIMITS.titleLength) return t('tree.rename.tooLong', { max: NOTES_LIMITS.titleLength });
  return null;
}

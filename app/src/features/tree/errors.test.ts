import { describe, expect, it } from 'vitest';
import { NotesError } from '../../services/notes';
import { moveErrorText } from './errors';

describe('moveErrorText', () => {
  const readOnly = new NotesError('read-only', 'encrypted');

  it('names the protected-section rule when a move touches one', () => {
    expect(moveErrorText(readOnly, 'Secret plans', true)).toBe(
      'Pages can’t move into or out of a password-protected section, so "Secret plans" stayed where it was.',
    );
  });

  it('keeps the read-only words for other refusals', () => {
    expect(moveErrorText(readOnly, 'Plans', false)).toBe('"Plans" is read-only, so nothing changed.');
    expect(moveErrorText(new NotesError('not-found', 'gone'), 'Plans', true)).toBe(
      '"Plans" is gone, so nothing changed.',
    );
  });
});

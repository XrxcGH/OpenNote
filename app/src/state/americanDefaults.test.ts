// The owner's rule: everything that has a default for English uses American English. These tests fail if a default
// changes to a British one.
import { describe, expect, it } from 'vitest';
import { formatDate, formatNumber, formatTime } from '../strings/format';
import {
  DEFAULT_LOCALE,
  ENGLISH_DIALECTS,
  dictionaryLanguageFor,
  languageFor,
  normalizeLocale,
  spellingVariant,
} from './language';
import { DEFAULT_SETTINGS } from './settings';

describe('American English defaults', () => {
  it('uses en-US as the default locale and the first English choice', () => {
    expect(DEFAULT_LOCALE).toBe('en-US');
    expect(normalizeLocale(undefined)).toBe('en-US');
    expect(normalizeLocale('not a tag!')).toBe('en-US');
    expect(ENGLISH_DIALECTS[0]).toEqual({ tag: 'en-US', name: 'English (United States)' });
  });

  it('saves en-US in the default settings', () => {
    expect(DEFAULT_SETTINGS.language.locale).toBe('en-US');
  });

  it('gives the spell checker, dictionary and thesaurus American spelling for the default locale', () => {
    const choices = languageFor(DEFAULT_LOCALE);
    expect(choices.spelling).toEqual(['en-US']);
    expect(choices.dictionary).toMatchObject({ spelling: 'us', pack: 'english' });
    expect(dictionaryLanguageFor('en-US').spelling).toBe('us');
    expect(spellingVariant('en-GB')).toBe('gb');
  });

  it('formats dates, times and numbers the American way', () => {
    expect(formatDate('2026-09-30T12:00:00')).toBe('Sep 30, 2026');
    expect(formatTime('2026-09-30T14:05:00')).toMatch(/^2:05\sPM$/);
    expect(formatNumber(1234567.5)).toBe('1,234,567.5');
  });
});

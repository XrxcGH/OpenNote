import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultBootData } from '../boot/defaults';
import { createWebPlatform } from '../platform/web';
import {
  DEFAULT_LOCALE,
  ENGLISH_DIALECTS,
  currentLocale,
  dictionaryLanguage,
  handwritingSentences,
  hyphenationLanguage,
  languageFor,
  normalizeLocale,
  ocrLanguage,
  recognitionLanguage,
  setLocale,
  spellingLanguages,
  voiceLanguage,
} from './language';
import { getSettings, initSettings, updateSettings } from './settings';
import { resetStores } from './store';

afterEach(() => {
  resetStores();
  vi.unstubAllGlobals();
});

function start() {
  const platform = createWebPlatform();
  initSettings(defaultBootData(), platform);
  return platform;
}

describe('the default language', () => {
  it('is English (United States) in settings and in every subsystem', () => {
    start();
    expect(getSettings().language.locale).toBe('en-US');
    expect(currentLocale()).toBe(DEFAULT_LOCALE);
    expect(spellingLanguages()).toEqual(['en-US']);
    expect(recognitionLanguage()).toBe('en-US');
    expect(ocrLanguage()).toBe('en-US');
    expect(voiceLanguage()).toBe('en-US');
    expect(hyphenationLanguage()).toBe('en');
    expect(dictionaryLanguage()).toMatchObject({ locale: 'en-US', language: 'en', spelling: 'us', pack: 'english' });
  });

  it('stays American English when Windows uses another language', () => {
    vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE', 'en-GB'] });
    start();
    expect(currentLocale()).toBe('en-US');
    expect(spellingLanguages()).toEqual(['en-US']);
    expect(ocrLanguage()).toBe('en-US');
  });

  it('falls back to American English for a value that is not a language tag', () => {
    for (const bad of ['', 'en_US', 'not a tag', null, 42, undefined]) expect(normalizeLocale(bad)).toBe('en-US');
    expect(normalizeLocale('en-gb')).toBe('en-GB');
  });

  it('offers the seven other English dialects after American English', () => {
    expect(ENGLISH_DIALECTS.map((choice) => choice.tag)).toEqual([
      'en-US',
      'en-GB',
      'en-CA',
      'en-AU',
      'en-NZ',
      'en-IE',
      'en-IN',
      'en-ZA',
    ]);
  });
});

describe('a chosen language', () => {
  it('is saved through the settings and survives a restart', async () => {
    const platform = start();
    await setLocale('en-GB');
    expect(getSettings().language.locale).toBe('en-GB');
    const saved = await platform.settings.update({});
    expect(saved.language.locale).toBe('en-GB');
    resetStores();
    initSettings({ ...defaultBootData(), settings: saved }, platform);
    expect(currentLocale()).toBe('en-GB');
  });

  it('reaches spelling, recognition, OCR, the voice, hyphenation, and the dictionary', async () => {
    start();
    await setLocale('en-AU');
    expect(spellingLanguages()).toEqual(['en-AU']);
    expect(recognitionLanguage()).toBe('en-AU');
    expect(ocrLanguage()).toBe('en-AU');
    expect(voiceLanguage()).toBe('en-AU');
    expect(hyphenationLanguage()).toBe('en');
    expect(dictionaryLanguage()).toMatchObject({ locale: 'en-AU', pack: 'english', spelling: 'gb' });
    expect(handwritingSentences()).toMatchObject({ locale: 'en-AU', inLanguage: true });
  });

  it('keeps the English pack when no dictionary exists for the language', async () => {
    start();
    await setLocale('de-DE');
    expect(dictionaryLanguage()).toEqual({
      locale: 'de-DE',
      language: 'de',
      spelling: 'gb',
      pack: null,
      fallbackPack: 'english',
    });
    expect(languageFor('de-DE')).toMatchObject({ spelling: ['de-DE'], ocr: 'de-DE', hyphenation: 'de' });
    expect(handwritingSentences().inLanguage).toBe(false);
  });

  it('lets the spelling languages chosen in Editing settings win over it', async () => {
    start();
    await setLocale('en-GB');
    await updateSettings({ editing: { spelling: { languages: ['fr-FR', 'en-US'] } } });
    expect(spellingLanguages()).toEqual(['fr-FR', 'en-US']);
  });

  it('refuses a value that is not a language tag', async () => {
    start();
    await expect(updateSettings({ language: { locale: 'en_US' } })).rejects.toMatchObject({ code: 'invalid' });
    expect(getSettings().language.locale).toBe('en-US');
  });
});

describe('the handwriting sentences', () => {
  it('are in American English', () => {
    const text = languageFor('en-US').handwriting.sentences.join(' ');
    expect(text).toMatch(/\bGray\b/);
    expect(text).toMatch(/\bcolor\b/);
    expect(text).not.toMatch(/\b(grey|colour|favourite|organise)\b/i);
  });
});

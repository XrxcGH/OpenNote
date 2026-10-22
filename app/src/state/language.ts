// The language of everything that reads or writes words (spelling and autocorrect, the dictionary, hyphenation, the
// read-aloud voice, handwriting and math recognition, OCR, and the handwriting sentences). One settings value,
// settings.language.locale, holds the choice. It is American English until the person picks another in setup or
// Settings, even when Windows itself uses another language. Every subsystem asks this file instead of reading
// navigator.language or the Windows profile, so they all follow one choice.

import { getSettings, updateSettings, useSettings } from './settings';

export const DEFAULT_LOCALE = 'en-US';

/** A language the person can choose, named in English. */
export interface LocaleChoice {
  tag: string;
  name: string;
}

/** The English dialects setup offers first. The interface text stays American English for now. */
export const ENGLISH_DIALECTS: readonly LocaleChoice[] = [
  { tag: 'en-US', name: 'English (United States)' },
  { tag: 'en-GB', name: 'English (United Kingdom)' },
  { tag: 'en-CA', name: 'English (Canada)' },
  { tag: 'en-AU', name: 'English (Australia)' },
  { tag: 'en-NZ', name: 'English (New Zealand)' },
  { tag: 'en-IE', name: 'English (Ireland)' },
  { tag: 'en-IN', name: 'English (India)' },
  { tag: 'en-ZA', name: 'English (South Africa)' },
];

const TAG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

/** A tag in its standard case, or American English when the value isn't a language tag. */
export function normalizeLocale(tag: unknown): string {
  if (typeof tag !== 'string' || !TAG.test(tag)) return DEFAULT_LOCALE;
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? DEFAULT_LOCALE;
  } catch {
    return DEFAULT_LOCALE;
  }
}

/** The chosen locale, such as "en-US". */
export function currentLocale(): string {
  return normalizeLocale(getSettings().language.locale);
}

export function useLocale(): string {
  return normalizeLocale(useSettings((settings) => settings.language.locale));
}

/** The language part of a tag, in lowercase: "en" for "en-GB". */
export function languageOf(tag: string): string {
  return tag.split('-')[0]?.toLowerCase() ?? 'en';
}

export const isEnglish = (tag: string): boolean => languageOf(tag) === 'en';

/** A language's name in English, such as "English (United Kingdom)" or "German (Germany)". */
export function localeName(tag: string): string {
  const known = ENGLISH_DIALECTS.find((choice) => choice.tag.toLowerCase() === tag.toLowerCase());
  if (known) return known.name;
  try {
    return new Intl.DisplayNames('en-US', { type: 'language', languageDisplay: 'standard' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Which spelling headwords and suggestions prefer. Only the United States uses American spelling first. */
export type SpellingVariant = 'us' | 'gb';

export const spellingVariant = (tag: string): SpellingVariant => (tag.toLowerCase() === 'en-us' ? 'us' : 'gb');

/**
 * What the dictionary and thesaurus read. The English pack (Open English WordNet and Moby) is the only one built;
 * every English dialect uses it, with the dialect's spelling first. For another language `pack` is null and the
 * English pack stays available through `fallbackPack`.
 */
export interface DictionaryLanguage {
  locale: string;
  language: string;
  spelling: SpellingVariant;
  pack: 'english' | null;
  fallbackPack: 'english';
}

export function dictionaryLanguageFor(locale: string): DictionaryLanguage {
  const english = isEnglish(locale);
  return {
    locale,
    language: languageOf(locale),
    spelling: spellingVariant(locale),
    pack: english ? 'english' : null,
    fallbackPack: 'english',
  };
}

/** The sentences the "My handwriting" step asks people to write. Only English is written so far. */
const ENGLISH_SENTENCES: readonly string[] = [
  'The quick brown fox jumps over the lazy dog.',
  'Gray clouds drifted past the color of the old harbor.',
  'Please organize the favorite recipes in a neat row.',
];

export interface HandwritingSentences {
  locale: string;
  sentences: readonly string[];
  /** False when no sentences exist for the language yet and the English ones stand in. */
  inLanguage: boolean;
}

export function handwritingSentencesFor(locale: string): HandwritingSentences {
  return { locale, sentences: ENGLISH_SENTENCES, inLanguage: isEnglish(locale) };
}

/** What each subsystem receives for one locale. */
export interface LanguageChoices {
  locale: string;
  /** Spell check and autocorrect. */
  spelling: string[];
  /** Handwriting and math recognition. */
  recognition: string;
  ocr: string;
  /** The read-aloud voice's language. */
  voice: string;
  /** The language hyphenation and syllable breaks use. */
  hyphenation: string;
  dictionary: DictionaryLanguage;
  handwriting: HandwritingSentences;
}

export function languageFor(locale: string): LanguageChoices {
  const tag = normalizeLocale(locale);
  return {
    locale: tag,
    spelling: [tag],
    recognition: tag,
    ocr: tag,
    voice: tag,
    hyphenation: languageOf(tag),
    dictionary: dictionaryLanguageFor(tag),
    handwriting: handwritingSentencesFor(tag),
  };
}

/**
 * The spelling languages in use: the ones the person chose in Settings, Editing, Spelling, or the chosen locale
 * when none are chosen. Windows' own language never decides.
 */
export function spellingLanguages(): string[] {
  const chosen = getSettings().editing.spelling.languages;
  return chosen.length > 0 ? [...chosen] : languageFor(currentLocale()).spelling;
}

export const recognitionLanguage = (): string => languageFor(currentLocale()).recognition;
export const ocrLanguage = (): string => languageFor(currentLocale()).ocr;
export const voiceLanguage = (): string => languageFor(currentLocale()).voice;
export const hyphenationLanguage = (): string => languageFor(currentLocale()).hyphenation;
export const handwritingSentences = (): HandwritingSentences => languageFor(currentLocale()).handwriting;

/**
 * The one function the dictionary calls: which language and pack to look words up in, and which spelling comes first.
 */
export const dictionaryLanguage = (): DictionaryLanguage => languageFor(currentLocale()).dictionary;

/** Changes the language everywhere, and saves it. */
export function setLocale(tag: string): Promise<void> {
  return updateSettings({ language: { locale: normalizeLocale(tag) } });
}

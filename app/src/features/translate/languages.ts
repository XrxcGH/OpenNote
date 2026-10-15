// The languages the dialog offers as a target (A3-25). Names are written in each language, so a person can find theirs
// whatever the interface says. A language is only usable when an installed engine has a pack that reaches it.
export interface Language {
  /** BCP 47 primary tag. */
  code: string;
  /** The name in that language. */
  name: string;
}

export const LANGUAGES: readonly Language[] = [
  { code: 'ar', name: 'العربية' },
  { code: 'zh', name: '中文' },
  { code: 'nl', name: 'Nederlands' },
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'de', name: 'Deutsch' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: '日本語' },
  { code: 'ko', name: '한국어' },
  { code: 'pl', name: 'Polski' },
  { code: 'pt', name: 'Português' },
  { code: 'ru', name: 'Русский' },
  { code: 'es', name: 'Español' },
  { code: 'sv', name: 'Svenska' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'uk', name: 'Українська' },
  { code: 'vi', name: 'Tiếng Việt' },
];

export const nameOf = (code: string): string =>
  LANGUAGES.find((language) => language.code === code.split('-')[0]?.toLowerCase())?.name ?? code;

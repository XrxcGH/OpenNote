// Small natural-language helpers shared by the prose rules.

const WORD_PATTERN = /[A-Za-z][A-Za-z'’-]*/g;

/** Words made of letters (with inner apostrophes or hyphens). Numbers and symbols are skipped. */
export function words(text: string): string[] {
  return text.match(WORD_PATTERN) ?? [];
}

export function wordCount(text: string): number {
  return words(text).length;
}

/** Removes Markdown and HTML markup so only readable text is left. */
export function cleanInline(text: string): string {
  return text
    .replace(/`[^`]*`/g, '§')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<https?:[^>]*>/g, ' ')
    .replace(/https?:\/\/[^\s)]+/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/(\*\*|__|\*|~~)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Removes text inside double quotes, so quoted sources aren't held to our style rules. */
export function stripQuotes(text: string): string {
  return text.replace(/"[^"]*"/g, '§').replace(/“[^”]*”/g, '§');
}

const ABBREVIATIONS = ['e.g.', 'i.e.', 'vs.', 'etc.', 'approx.', 'no.', 'dr.', 'mr.', 'ms.', 'fig.'];

/** Splits a block of prose into sentences. Common abbreviations don't end a sentence. */
export function sentences(text: string): string[] {
  let guarded = text;
  ABBREVIATIONS.forEach((abbr, i) => {
    guarded = guarded.split(abbr).join(`\u0001${i}\u0001`);
    guarded = guarded.split(capitalize(abbr)).join(`\u0002${i}\u0002`);
  });
  const parts = guarded.split(/(?<=[.!?])\s+(?=["“(]?[A-Z0-9])/);
  return parts.map((part) => restoreAbbreviations(part).trim()).filter((part) => wordCount(part) > 0);
}

function restoreAbbreviations(text: string): string {
  return text
    .replace(/\u0001(\d+)\u0001/g, (_, i: string) => ABBREVIATIONS[Number(i)])
    .replace(/\u0002(\d+)\u0002/g, (_, i: string) => capitalize(ABBREVIATIONS[Number(i)]));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Estimates syllables with the usual vowel-group heuristic. Good enough for readability scores. */
export function syllables(word: string): number {
  const lower = word.toLowerCase().replace(/[^a-z]/g, '');
  if (lower.length <= 3) return 1;
  const trimmed = lower.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/** Flesch-Kincaid grade level: roughly the US school grade needed to read the text easily. */
export function gradeLevel(sentenceList: string[]): number {
  const allWords = sentenceList.flatMap((s) => words(s));
  if (allWords.length === 0 || sentenceList.length === 0) return 0;
  const totalSyllables = allWords.reduce((sum, w) => sum + syllables(w), 0);
  const wordsPerSentence = allWords.length / sentenceList.length;
  const syllablesPerWord = totalSyllables / allWords.length;
  return 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
}

/** Keeps the capitalization style of `original` when suggesting `replacement`. */
export function matchCase(original: string, replacement: string): string {
  if (original === original.toUpperCase() && original.length > 1) return replacement.toUpperCase();
  if (original.charAt(0) === original.charAt(0).toUpperCase()) return capitalize(replacement);
  return replacement;
}

/** Escapes a literal string for use inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Builds a case-insensitive, whole-word pattern for a phrase. */
export function phrasePattern(phrase: string): RegExp {
  const body = escapeRegExp(phrase).replace(/\s+/g, '\\s+');
  const start = /^\w/.test(phrase) ? '\\b' : '';
  const end = /\w$/.test(phrase) ? '\\b' : '';
  return new RegExp(`${start}${body}${end}`, 'gi');
}

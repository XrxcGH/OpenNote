// Choice columns (Further features, Phase 7). A choice cell keeps the names of its options as plain text, joined by
// a comma and a space when the column allows several. So every other reader, every export, and every formula sees
// the words, and a column of choices is still a column of text. The options themselves live in the column's schema.

/** The text between two names in a cell that holds several. */
export const CHOICE_SEPARATOR = ', ';

/** The longest name an option may have. */
export const MAX_CHOICE_NAME = 60;

/** The most options one column may offer. */
export const MAX_CHOICES = 50;

/** The names in a cell's text, in the order written, without blanks. */
export function splitChoices(text: string): string[] {
  return text
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');
}

export const joinChoices = (names: readonly string[]): string => names.join(CHOICE_SEPARATOR);

/** A name an option can have: one line, no commas (they would split the name in a cell), at most 60 characters. */
export function cleanChoiceName(name: string): string {
  return name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_CHOICE_NAME).trim();
}

/** The index of the option a name means, ignoring case, or -1. */
export function choiceIndex(options: readonly string[], name: string): number {
  const wanted = name.trim().toLowerCase();
  return options.findIndex((option) => option.toLowerCase() === wanted);
}

/**
 * Where a cell sorts among the options: the place of its first option, with cells that hold more options after the
 * ones that hold fewer. A name no option has sorts after every option. Empty cells have no place (null).
 */
export function choiceRank(options: readonly string[], text: string): number | null {
  const names = splitChoices(text);
  if (names.length === 0) return null;
  const places = names.map((name) => choiceIndex(options, name)).map((at) => (at < 0 ? options.length : at));
  return Math.min(...places) + Math.min(names.length, 99) / 100;
}

// Blanks in a card's text: {{word}} marks a word to hide. Anki's {{c1::word::hint}} form is read as a blank too.
const BLANK = /\{\{([^{}]+?)\}\}/g;
const ANKI = /\{\{c\d+::([^{}]*?)(?:::[^{}]*)?\}\}/g;

/** The words hidden by blanks, in order. */
export function blanksOf(text: string): string[] {
  return [...text.matchAll(BLANK)].map((match) => match[1].trim()).filter(Boolean);
}

/** The text with each blank replaced by `mark`. */
export function hideBlanks(text: string, mark = '[...]'): string {
  return text.replace(BLANK, mark);
}

/** The text with the braces taken off, so the answers read as part of the sentence. */
export function showBlanks(text: string): string {
  return text.replace(BLANK, (_all, word: string) => word.trim());
}

/** Anki's cloze markers turned into this app's blanks. */
export function fromAnkiCloze(text: string): string {
  return text.replace(ANKI, (_all, word: string) => `{{${word}}}`);
}

/** The text cut into plain parts and blanks, for drawing the blanks apart from the words around them. */
export function splitBlanks(text: string): { text: string; blank: boolean }[] {
  const parts: { text: string; blank: boolean }[] = [];
  let last = 0;
  for (const match of text.matchAll(BLANK)) {
    if (match.index > last) parts.push({ text: text.slice(last, match.index), blank: false });
    parts.push({ text: match[1].trim(), blank: true });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), blank: false });
  return parts;
}

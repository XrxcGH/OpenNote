// Case and accent folding for matching titles, the same way type-ahead compares them.

/** Lowercase, without accents: "Café" and "cafe" fold to the same text. */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// Markup tags removed from text, for the places that read words out of HTML or subtitle files.

/**
 * The text without its tags. A pass can join the pieces around a tag into a new one, as in "<<b>script>", so it
 * repeats until a pass removes nothing.
 */
export function stripTags(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(/<[^>]*>/g, '');
    if (next === current) return next;
    current = next;
  }
}

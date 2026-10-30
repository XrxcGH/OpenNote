// Typed lists, one item to a line, as the tools with text fields read them: the words of each line that is not
// blank and not a # comment, with its line number for the error message.
export interface TypedLine {
  readonly words: readonly string[];
  readonly line: number;
}

export const typedLines = (text: string): TypedLine[] =>
  text
    .split(/\r?\n/)
    .map((raw, i) => ({
      words: raw
        .trim()
        .split(/[\s,;]+/)
        .filter(Boolean),
      line: i + 1,
    }))
    .filter((one) => one.words.length > 0 && !one.words[0].startsWith('#'));

// Text to columns: splits the text of one column into several, by a delimiter or at fixed widths.

export interface DelimitedSplit {
  mode: 'delimited';
  /** Each of these strings separates parts. Several may be given, such as ";" and ",". */
  delimiters: readonly string[];
  /** Treat consecutive delimiters as one. */
  consecutive?: boolean;
  /** The quote that keeps delimiters inside it together. Default is the double quote; '' turns it off. */
  qualifier?: string;
}

export interface FixedSplit {
  mode: 'fixed';
  /** Character positions where a new part starts, counted from 0 at the start of the text. */
  breaks: readonly number[];
}

export type Split = DelimitedSplit | FixedSplit;

function splitDelimited(text: string, rule: DelimitedSplit): string[] {
  const delimiters = rule.delimiters.filter((d) => d !== '').sort((a, b) => b.length - a.length);
  const quote = rule.qualifier ?? '"';
  if (delimiters.length === 0) return [text];
  const parts: string[] = [];
  let current = '';
  let inQuote = false;
  let lastWasDelimiter = false;
  for (let i = 0; i < text.length;) {
    if (quote !== '' && text.startsWith(quote, i)) {
      if (inQuote && text.startsWith(quote, i + quote.length)) {
        current += quote;
        i += quote.length * 2;
      } else {
        inQuote = !inQuote;
        i += quote.length;
      }
      lastWasDelimiter = false;
      continue;
    }
    const hit = inQuote ? undefined : delimiters.find((d) => text.startsWith(d, i));
    if (hit !== undefined) {
      if (!(rule.consecutive && lastWasDelimiter)) parts.push(current);
      current = '';
      lastWasDelimiter = true;
      i += hit.length;
      continue;
    }
    current += text[i];
    lastWasDelimiter = false;
    i++;
  }
  parts.push(current);
  return parts;
}

function splitFixed(text: string, rule: FixedSplit): string[] {
  const cuts = [...new Set(rule.breaks.filter((b) => Number.isInteger(b) && b > 0 && b < text.length))].sort(
    (a, b) => a - b,
  );
  const parts: string[] = [];
  let from = 0;
  for (const cut of cuts) {
    parts.push(text.slice(from, cut));
    from = cut;
  }
  parts.push(text.slice(from));
  return parts;
}

/** The parts of one text. */
export function splitText(text: string, rule: Split): string[] {
  return rule.mode === 'delimited' ? splitDelimited(text, rule) : splitFixed(text, rule);
}

/** Splits every text; the result is one list of parts per input. */
export function textToColumns(texts: readonly string[], rule: Split): string[][] {
  return texts.map((text) => splitText(text, rule));
}

/** How many columns the split needs: the most parts any text gives. */
export function splitWidth(parts: readonly (readonly string[])[]): number {
  return parts.reduce((most, row) => Math.max(most, row.length), 0);
}

// Alt+X, both ways (the Word behavior, from its documented description): a run of 2 to 6 hexadecimal digits before the
// caret, with an optional "U+" in front, becomes the character with that code. When there is no such run, the
// character before the caret becomes its code. The pure part is here; the command is in registrations/textSymbols.ts.
import { hexOf } from './model';

export interface AltXResult {
  /** How many UTF-16 units before the caret (or the selection start) the replacement covers. */
  length: number;
  replacement: string;
}

/** Text only: no controls (tab excepted), surrogates, noncharacters, or the object placeholder U+FFFC. */
const validCode = (cp: number): boolean => {
  if (cp <= 0 || cp > 0x10ffff) return false;
  if (cp < 0x20 && cp !== 9) return false;
  if (cp >= 0x7f && cp <= 0x9f) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return false;
  return cp !== 0xfffc && (cp & 0xfffe) !== 0xfffe;
};

/**
 * What Alt+X does to the text just before the caret, or null when there is nothing to convert. The longest run of up
 * to six digits that names a valid code wins, so "a2014" reads as U+A2014 (the same quirk as Word); select the digits
 * first to convert exactly them.
 */
export function altX(before: string): AltXResult | null {
  const run = /([0-9a-fA-F]{2,6})$/.exec(before);
  if (run?.[1]) {
    const digits = run[1];
    for (let n = digits.length; n >= 2; n -= 1) {
      const part = digits.slice(digits.length - n);
      const cp = parseInt(part, 16);
      if (!validCode(cp)) continue;
      const prefixed = /[uU]\+$/.exec(before.slice(0, before.length - n));
      return { length: n + (prefixed ? 2 : 0), replacement: String.fromCodePoint(cp) };
    }
  }
  const last = [...before].pop();
  if (last === undefined) return null;
  return { length: last.length, replacement: hexOf(last.codePointAt(0) ?? 0) };
}

/** Alt+X on selected text: exactly its digits become the character, or a single selected character becomes its code. */
export function altXSelected(text: string): string | null {
  const m = /^(?:u\+)?([0-9a-f]{1,6})$/i.exec(text);
  if (m?.[1]) {
    const cp = parseInt(m[1], 16);
    if (validCode(cp)) return String.fromCodePoint(cp);
  }
  if ([...text].length === 1) return hexOf(text.codePointAt(0) ?? 0);
  return null;
}

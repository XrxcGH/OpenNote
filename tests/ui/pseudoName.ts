// Names that match in English and in the pseudo-locale (A4-37). The pseudo-locale (app/src/strings/pseudo.ts) accents
// some letters, pads the end, and wraps the string in markers. A screen's steps therefore cannot find a button by its
// English name there. loose('Export…') matches "Export…" and "⟦Éxpórt…·····⟧" alike, so one set of steps opens a
// screen in both. An option makes the match a prefix, or anywhere in the name.

import { pseudoize } from '../../app/src/strings/pseudo.ts';

const escape = (char: string) => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The letter, and the letter the pseudo-locale writes in its place, as a class of the two. */
function either(char: string): string {
  const pseudo = [...pseudoize(char)][1];
  return pseudo !== char && pseudo !== undefined && !'⟦⟧·'.includes(pseudo)
    ? `[${escape(char)}${escape(pseudo)}]`
    : escape(char);
}

export interface Loose {
  /** Match the start of the name only. */
  prefix?: boolean;
  /** Match anywhere in the name. */
  contains?: boolean;
}

export function loose(text: string, how: Loose = {}): RegExp {
  const body = [...text].map(either).join('');
  const start = how.contains ? '' : '^⟦?';
  const end = how.contains || how.prefix ? '' : '·*⟧?$';
  return new RegExp(`${start}${body}${end}`);
}

// Languages for spell check (lane text:language-direction): how a textblock's text splits into the parts each
// language checks, and which installed checker a language tag uses. Pure, so the engine and its tests share it.
import type { SpellLang } from '../../../editor/host';

/** A part of one textblock's text that one request checks: `text` starts at `offset` of the textblock's text. */
export interface Piece {
  readonly item: number;
  readonly offset: number;
  readonly text: string;
  /** Null for the page's languages. */
  readonly lang: string | null;
}

/**
 * The pieces of a text: the whole text with its own-language parts blanked, for the page's languages, then each
 * own-language part. Blank pieces are left out, and blanking keeps offsets, so errors map back by adding `offset`.
 */
export function piecesOf(item: { text: string; langs?: readonly SpellLang[] }, index: number): Piece[] {
  const langs = item.langs ?? [];
  if (!langs.length) return [{ item: index, offset: 0, text: item.text, lang: null }];
  let rest = '';
  let at = 0;
  const own: Piece[] = [];
  for (const span of langs) {
    const start = Math.max(at, Math.min(span.start, item.text.length));
    const end = Math.min(item.text.length, span.start + span.length);
    if (end <= start) continue;
    rest += item.text.slice(at, start) + ' '.repeat(end - start);
    own.push({ item: index, offset: start, text: item.text.slice(start, end), lang: span.lang });
    at = end;
  }
  rest += item.text.slice(at);
  return [{ item: index, offset: 0, text: rest, lang: null }, ...own].filter((piece) => piece.text.trim() !== '');
}

/**
 * The installed checker for a language tag: the same tag in any case, else the first one with the same primary
 * language (a page's "fr" uses an installed "fr-FR"). Null when no checker knows the language, as Word leaves text
 * whose proofing tools are missing unchecked.
 */
export function resolveLanguage(
  tag: string,
  installed: readonly { tag: string; isDefault?: boolean }[],
): string | null {
  const lower = tag.toLowerCase();
  const exact = installed.find((language) => language.tag.toLowerCase() === lower);
  if (exact) return exact.tag;
  const primary = lower.split('-')[0];
  const same = installed.filter((language) => language.tag.toLowerCase().split('-')[0] === primary);
  return (same.find((language) => language.isDefault) ?? same[0])?.tag ?? null;
}

/** A language's name in American English, such as "French (Canada)" for fr-CA; the tag when no name is known. */
export function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(['en-US'], { type: 'language' }).of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** The own language of the text at `offset`, if any. */
export function langAt(langs: readonly SpellLang[] | undefined, offset: number): string | undefined {
  return langs?.find((span) => span.start <= offset && offset < span.start + span.length)?.lang;
}

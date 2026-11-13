// The DOM attributes of a paragraph's direction, language, and hyphenation (lane text:language-direction, text
// DESIGN.md 2.2). The editor's decorations and the static render both use them, so a paragraph looks the same before
// and after its editor mounts. It imports nothing from Tiptap, so the static render stays small.
import { paraFormat } from './attributes';
import type { Align } from './attributes';

export type Direction = 'ltr' | 'rtl';
export type PhysicalAlign = 'left' | 'right' | 'center' | 'justify';

/** The side a logical alignment takes in a paragraph of the given direction. */
export function physicalAlign(align: Align | undefined, dir: Direction): PhysicalAlign {
  switch (align ?? 'start') {
    case 'start':
      return dir === 'rtl' ? 'right' : 'left';
    case 'end':
      return dir === 'rtl' ? 'left' : 'right';
    case 'center':
      return 'center';
    default:
      return 'justify';
  }
}

/**
 * The DOM attributes a paragraph's direction, language, and hyphenation give it, or null when it sets none.
 * `pageHyphenate` is the page's default (`view.text.hyphenate`), which a paragraph's own `hyphenate` overrides.
 */
export function directionDom(
  attrs: Readonly<Record<string, unknown>>,
  pageHyphenate = false,
): Record<string, string> | null {
  if (attrs.dir == null && attrs.lang == null && attrs.align == null && attrs.hyphenate == null && !pageHyphenate) {
    return null;
  }
  const format = paraFormat(attrs);
  const out: Record<string, string> = {};
  const style: string[] = [];
  if (format.dir) out.dir = format.dir;
  if (format.lang) out.lang = format.lang;
  // Start and end become sides. Center, justify, and distribute need no side, so paraStyle's declarations stand.
  const logical = format.align === undefined || format.align === 'start' || format.align === 'end';
  if (logical && (format.dir || format.align))
    style.push(`text-align: ${physicalAlign(format.align, format.dir ?? 'ltr')}`);
  const hyphenate = format.hyphenate ?? pageHyphenate;
  if (hyphenate) style.push('hyphens: auto', '-webkit-hyphens: auto');
  else if (format.hyphenate === false) style.push('hyphens: manual', '-webkit-hyphens: manual');
  if (style.length) out.style = style.join('; ');
  return Object.keys(out).length ? out : null;
}

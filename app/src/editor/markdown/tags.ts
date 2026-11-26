// SPEC 7.9 and 7.10: the reserved inline tag grammar of Markdown 2, the marks its tags name, and the tags a mark is
// written as. A tag in the grammar names a known mark when its name, its exact attributes, and every value match a
// row of SPEC 7.10. Every other tag in the grammar is a foreign mark, which keeps its exact bytes (R-INL-9). This file
// works on plain data, so the schema's DOM rules and the Markdown reader and writer share it.
import {
  BOX_STYLES,
  CAPS_VALUES,
  DIRECTIONS,
  FLOAT_EDGES,
  SCALE_PERCENT,
  SHIFT_POINTS,
  TRACKING_POINTS,
  WEIGHT_MARK,
  isColor,
  isElementId,
  isFontName,
  isHighlightColor,
  isKern,
  isLanguageTag,
  isNumberText,
  isOtfFeatures,
  isStyleName,
  isTextEffect,
  isTextSize,
  isUnderlineLine,
} from '../schema/constants';
import type { MarkName } from '../schema/constants';

/** R-INL-1: the tag names of the grammar. */
export const TAG_NAMES = ['span', 'u', 'del', 'mark', 'ins', 's'] as const;

/** R-INL-1 and R-INL-2: a name, then 1 or more attributes of one space each. Counted in code points. */
const OPEN_TAG = /^<(span|u|del|mark|ins|s)((?: (?:lang|dir|data-[a-z0-9-]{1,16})="[^"<>&\p{Cc}]{0,200}")+)>$/u;
const ATTRIBUTE = / (lang|dir|data-[a-z0-9-]{1,16})="([^"]*)"/g;
/** R-INL-4: closing tags, the version 1 tags without attributes included. */
const CLOSE_TAG = /^<\/(span|u|del|mark|ins|s|sub|sup|em|strong)>$/;
const MAX_ATTRIBUTES = 8;

/** A tag's mark as plain data: the schema mark's name and its attributes. */
export interface TagMark {
  readonly type: MarkName;
  readonly attrs: Readonly<Record<string, string | null>>;
}

/** An opening tag of the grammar: its name and its attributes in order. */
export interface OpenTag {
  readonly name: string;
  readonly attrs: readonly (readonly [string, string])[];
}

/** SPEC 7.4: the version 1 tags without attributes, by their exact text. */
const V1_TAGS: Readonly<Record<string, readonly [string, TagMark]>> = {
  '<u>': ['u', { type: 'underline', attrs: {} }],
  '<sub>': ['sub', { type: 'subscript', attrs: {} }],
  '<sup>': ['sup', { type: 'superscript', attrs: {} }],
  '<em>': ['em', { type: 'italic', attrs: {} }],
  '<strong>': ['strong', { type: 'bold', attrs: {} }],
  '<del>': ['del', { type: 'strike', attrs: {} }],
  '<mark>': ['mark', { type: 'highlight', attrs: {} }],
};

/** One attribute of a `<span>` that is a whole mark, with the mark attribute it fills and its value grammar. */
interface SpanMark {
  readonly type: MarkName;
  readonly key: string;
  readonly valid: (value: string) => boolean;
}

const oneOf = (list: readonly string[]) => (value: string) => list.includes(value);

/** SPEC 7.10: the marks that are a `<span>` with one attribute, by that attribute. */
export const SPAN_MARKS: Readonly<Record<string, SpanMark>> = {
  'data-float': { type: 'float', key: 'float', valid: oneOf(FLOAT_EDGES) },
  'data-comment': { type: 'comment', key: 'comment', valid: isElementId },
  'data-ins': { type: 'insertion', key: 'ins', valid: isElementId },
  'data-del': { type: 'deletion', key: 'del', valid: isElementId },
  'data-fmt': { type: 'formatChange', key: 'fmt', valid: isElementId },
  dir: { type: 'dir', key: 'dir', valid: oneOf(DIRECTIONS) },
  lang: { type: 'lang', key: 'lang', valid: isLanguageTag },
  'data-style': { type: 'charStyle', key: 'style', valid: isStyleName },
  'data-weight': { type: 'weight', key: 'weight', valid: (v) => isNumberText(v, WEIGHT_MARK) },
  'data-shade': { type: 'shade', key: 'shade', valid: isColor },
  'data-color': { type: 'textColor', key: 'color', valid: isColor },
  'data-font': { type: 'font', key: 'font', valid: isFontName },
  'data-size': { type: 'textSize', key: 'size', valid: isTextSize },
  'data-caps': { type: 'caps', key: 'caps', valid: oneOf(CAPS_VALUES) },
  'data-tracking': { type: 'tracking', key: 'tracking', valid: (v) => isNumberText(v, TRACKING_POINTS) },
  'data-scale': { type: 'scale', key: 'scale', valid: (v) => isNumberText(v, SCALE_PERCENT) },
  'data-shift': { type: 'shift', key: 'shift', valid: (v) => isNumberText(v, SHIFT_POINTS) },
  'data-kern': { type: 'kern', key: 'kern', valid: isKern },
  'data-otf': { type: 'otf', key: 'otf', valid: isOtfFeatures },
  'data-effect': { type: 'effect', key: 'effect', valid: isTextEffect },
};

/** The `<span>` attribute of each single-attribute mark, by mark name. */
export const SPAN_ATTRIBUTE: Readonly<Partial<Record<MarkName, string>>> = Object.fromEntries(
  Object.entries(SPAN_MARKS).map(([attribute, { type }]) => [type, attribute]),
);

/** R-INL-1 to R-INL-3: an opening tag of the grammar, or null when the text is not one. */
export function parseOpenTag(raw: string): OpenTag | null {
  const found = OPEN_TAG.exec(raw);
  if (!found) return null;
  const attrs = [...found[2].matchAll(ATTRIBUTE)].map((match) => [match[1], match[2]] as const);
  if (attrs.length > MAX_ATTRIBUTES) return null;
  for (let i = 1; i < attrs.length; i++) if (attrs[i - 1][0] >= attrs[i][0]) return null;
  return { name: found[1], attrs };
}

/** The name a closing tag closes, or null when the text is not a closing tag. */
export function closingName(raw: string): string | null {
  return CLOSE_TAG.exec(raw)?.[1] ?? null;
}

/** Whether the attributes are exactly these names, in this order. */
function hasExactly(tag: OpenTag, ...names: string[]): boolean {
  return tag.attrs.length === names.length && tag.attrs.every(([name], i) => name === names[i]);
}

function underlineOf(tag: OpenTag): TagMark | null {
  const values = Object.fromEntries(tag.attrs);
  const line = values['data-line'];
  const color = values['data-line-color'];
  if (hasExactly(tag, 'data-line') && isUnderlineLine(line)) return { type: 'underline', attrs: { line } };
  if (hasExactly(tag, 'data-line', 'data-line-color') && isUnderlineLine(line) && isColor(color)) {
    return { type: 'underline', attrs: { line, color } };
  }
  if (hasExactly(tag, 'data-line-color') && isColor(color)) return { type: 'underline', attrs: { color } };
  return null;
}

function spanOf(tag: OpenTag): TagMark | null {
  const [first, second] = tag.attrs;
  if (first[0] === 'data-box' && (BOX_STYLES as readonly string[]).includes(first[1])) {
    if (tag.attrs.length === 1) return { type: 'box', attrs: { style: first[1] } };
    if (hasExactly(tag, 'data-box', 'data-box-color') && isColor(second[1])) {
      return { type: 'box', attrs: { style: first[1], color: second[1] } };
    }
    return null;
  }
  const row = tag.attrs.length === 1 ? SPAN_MARKS[first[0]] : undefined;
  return row?.valid(first[1]) ? { type: row.type, attrs: { [row.key]: first[1] } } : null;
}

/** R-INL-7: the known mark of a tag in the grammar, or null when the tag is a foreign mark. */
export function knownMark(tag: OpenTag): TagMark | null {
  switch (tag.name) {
    case 'span':
      return spanOf(tag);
    case 'u':
      return underlineOf(tag);
    case 'del':
      return hasExactly(tag, 'data-line') && tag.attrs[0][1] === 'double'
        ? { type: 'strike', attrs: { line: 'double' } }
        : null;
    case 'mark':
      return hasExactly(tag, 'data-color') && isHighlightColor(tag.attrs[0][1])
        ? { type: 'highlight', attrs: { color: tag.attrs[0][1] } }
        : null;
    default:
      return null;
  }
}

/** What an opening tag means: the name its closing tag has, and its mark, known or foreign. Null for other text. */
export function readOpenTag(raw: string): { readonly name: string; readonly mark: TagMark } | null {
  const simple = V1_TAGS[raw];
  if (simple) return { name: simple[0], mark: simple[1] };
  const tag = parseOpenTag(raw);
  if (!tag) return null;
  return { name: tag.name, mark: knownMark(tag) ?? { type: 'foreign', attrs: { tag: raw } } };
}

/** Whether a foreign mark's stored tag is one: in the grammar, and not a known mark. */
export function isForeignTag(raw: string): boolean {
  const tag = parseOpenTag(raw);
  return tag !== null && knownMark(tag) === null;
}

/** R-INL-2: a value as a tag may hold it. The schema checks values on the way in; this keeps any other value inside
 * the grammar, so it reads back as a foreign mark and never as other markup. */
function value(text: unknown): string {
  return Array.from(String(text ?? '').replace(/["<>&\p{Cc}]/gu, ''))
    .slice(0, 200)
    .join('');
}

/** The opening and closing tags of a mark that has a tag form, or null for one that has none or can't be written. */
export function tagsOf(type: string, attrs: Readonly<Record<string, unknown>>): readonly [string, string] | null {
  switch (type) {
    case 'underline': {
      const line = attrs.line && attrs.line !== 'single' ? ` data-line="${value(attrs.line)}"` : '';
      const color = attrs.color ? ` data-line-color="${value(attrs.color)}"` : '';
      return [`<u${line}${color}>`, '</u>'];
    }
    case 'strike':
      return [attrs.line === 'double' ? '<del data-line="double">' : '<del>', '</del>'];
    case 'highlight':
      return [
        attrs.color && attrs.color !== 'honey' ? `<mark data-color="${value(attrs.color)}">` : '<mark>',
        '</mark>',
      ];
    case 'box': {
      const color = attrs.color ? ` data-box-color="${value(attrs.color)}"` : '';
      return [`<span data-box="${value(attrs.style)}"${color}>`, '</span>'];
    }
    case 'foreign': {
      const raw = String(attrs.tag ?? '');
      const tag = parseOpenTag(raw);
      return tag ? [raw, `</${tag.name}>`] : null;
    }
    case 'bold':
      return ['<strong>', '</strong>'];
    case 'italic':
      return ['<em>', '</em>'];
    case 'subscript':
      return ['<sub>', '</sub>'];
    case 'superscript':
      return ['<sup>', '</sup>'];
  }
  const attribute = SPAN_ATTRIBUTE[type as MarkName];
  if (!attribute) return null;
  const key = SPAN_MARKS[attribute].key;
  return [`<span ${attribute}="${value(attrs[key])}">`, '</span>'];
}

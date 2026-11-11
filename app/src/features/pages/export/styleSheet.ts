// Named styles of format version 2 (spec R-STY-1 to R-STY-8) for an exported page: reading the new keys, merging a
// page's style sheet over the notebook's, following `basedOn`, and writing the CSS for what the version 1 rules of
// style.ts don't cover. Run keys come out through the same `runStyle` the screen uses, and paragraph keys through
// `paraStyle`, so a style looks the same on screen, in HTML, and in print.

import { PARA_KEYS } from '../../../editor/paragraph/attributes';
import { paraStyle } from '../../../editor/render/paraStyle';
import { colorValue, runStyle } from '../../../editor/render/runStyle';
import { isColor, isStyleName, isUnderlineLine } from '../../../editor/schema/constants';
import { own } from '../layout/json';
import type { NotebookStyles, StyleSpec } from './style';

const MAX_CHAIN = 16;

const number = (value: unknown, lo: number, hi: number): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi ? value : undefined;

/** The keys of version 2 in a style object that are valid, each checked against its range (R-STY-1). */
export function readV2Keys(v: Readonly<Record<string, unknown>>): Partial<Mutable<StyleSpec>> {
  const out: Partial<Mutable<StyleSpec>> = {};
  if (v.type === 'paragraph' || v.type === 'character') out.type = v.type;
  if (typeof v.basedOn === 'string' && isStyleName(v.basedOn)) out.basedOn = v.basedOn;
  const sizePt = number(v.sizePt, 1, 1638);
  if (sizePt !== undefined) out.sizePt = sizePt;
  const weight = number(v.weight, 100, 900);
  if (weight !== undefined && weight % 100 === 0) out.weight = weight;
  if (typeof v.italic === 'boolean') out.italic = v.italic;
  if (
    typeof v.underline === 'string' &&
    (v.underline === 'none' || v.underline === 'single' || isUnderlineLine(v.underline))
  ) {
    out.underline = v.underline;
  }
  if (v.strike === 'single' || v.strike === 'double' || v.strike === 'none') out.strike = v.strike;
  if (v.caps === 'small' || v.caps === 'all' || v.caps === 'none') out.caps = v.caps;
  const tracking = number(v.tracking, -1584, 1584);
  if (tracking !== undefined) out.tracking = tracking;
  if (typeof v.textColor === 'string' && isColor(v.textColor)) out.textColor = v.textColor;
  if (typeof v.highlight === 'string' && (v.highlight === 'none' || isColor(v.highlight))) out.highlight = v.highlight;
  const paras: Record<string, unknown> = {};
  for (const key of PARA_KEYS) if (v[key] !== undefined && v[key] !== null) paras[key] = v[key];
  if (Object.keys(paras).length > 0) out.paras = paras;
  return out;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** A page's style sheet over the notebook's: each key of a style the page defines wins, the rest come from the notebook (R-STY-7). */
export function mergeSheets(notebook: NotebookStyles, page: NotebookStyles): NotebookStyles {
  const out: Record<string, StyleSpec> = { ...notebook };
  for (const [name, spec] of Object.entries(page)) out[name] = { ...own(notebook, name), ...spec };
  return out;
}

/**
 * A style with its `basedOn` chain folded in, root first, so a key of the style wins over the same key further up
 * (R-STY-4). The chain stops at a name seen before, at an undefined name, after 16 steps, and at a style of the other
 * type. A paragraph style other than `normal` is based on `normal` when it names no other style.
 */
export function resolveChain(name: string, styles: NotebookStyles): StyleSpec {
  const chain: StyleSpec[] = [];
  const seen = new Set<string>();
  let current: string | undefined = name;
  const type = own(styles, name)?.type ?? 'paragraph';
  while (current !== undefined && !seen.has(current) && chain.length < MAX_CHAIN) {
    const spec: StyleSpec | undefined = own(styles, current);
    if (!spec) break;
    seen.add(current);
    chain.push(spec);
    const next: string | undefined =
      spec.basedOn ?? (type === 'paragraph' && current !== 'normal' ? 'normal' : undefined);
    current = next !== undefined && (own(styles, next)?.type ?? 'paragraph') === type ? next : undefined;
  }
  return Object.assign({}, ...chain.reverse()) as StyleSpec;
}

/** The declarations of a style's version 2 keys. Size, color, font, and spacing of version 1 are written by style.ts. */
export function extraDeclarations(spec: StyleSpec): Record<string, string> {
  const out: Record<string, string> = {};
  if (spec.paras) Object.assign(out, paraStyle(spec.paras));
  if (spec.weight !== undefined) out['font-weight'] = String(spec.weight);
  if (spec.italic !== undefined) out['font-style'] = spec.italic ? 'italic' : 'normal';
  // One `text-decoration-line` holds the underline and the strike. The line style of either one is the style of both.
  const lines: string[] = [];
  if (spec.underline !== undefined && spec.underline !== 'none') {
    Object.assign(out, runStyle({ mark: 'underline', line: spec.underline === 'single' ? '' : spec.underline }));
    lines.push('underline');
  }
  if (spec.strike === 'double') Object.assign(out, runStyle({ mark: 'strike', line: 'double' }));
  if (spec.strike === 'single' || spec.strike === 'double') lines.push('line-through');
  if (lines.length > 0) out['text-decoration-line'] = lines.join(' ');
  else if (spec.underline === 'none' || spec.strike === 'none') out['text-decoration-line'] = 'none';
  if (spec.caps === 'small') out['font-variant-caps'] = 'small-caps';
  if (spec.caps === 'all') out['text-transform'] = 'uppercase';
  if (spec.caps === 'none') Object.assign(out, { 'font-variant-caps': 'normal', 'text-transform': 'none' });
  if (spec.tracking !== undefined) Object.assign(out, runStyle({ mark: 'tracking', tracking: spec.tracking }));
  if (spec.textColor !== undefined) out.color = colorValue(spec.textColor);
  if (spec.highlight !== undefined) {
    out['background-color'] = spec.highlight === 'none' ? 'transparent' : colorValue(spec.highlight);
  }
  return out;
}

/** A style's declarations as `property:value;`. */
export function declarationText(declarations: Readonly<Record<string, string>>): string {
  return Object.entries(declarations)
    .map(([property, value]) => `${property}:${value};`)
    .join('');
}

/** A style name as a CSS class suffix. */
export const classOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9-]/g, '-');

// How a style's look is worked out (text DESIGN.md 2.4, SPEC R-STY-4 to R-STY-7, R-THM-2). Lowest first: the base
// look, then each step of the style chain from the root down. At each step the app's value of that style comes
// first, then the notebook's, then the page's sheet, key by key.
//
// So the app's h1 sits above the notebook's `normal`. A built-in Heading 1 sits above Normal the same way
// (ECMA-376 Part 1, 17.7.2). A key the notebook leaves out keeps the app's value (SPEC 4.1). `paras`, the character
// style mark, and the run marks come after, in the editor and the page's CSS.
import { isStyleName } from '../../../editor/schema/constants';
import { LOOK_KEYS, MAX_CHAIN, MAX_STYLES, RUN_KEYS, readStyle } from './model';
import type { LookKey, StyleFormat, StyleSheetJson, StyleType } from './model';

/** The fonts of the theme tokens `+heading`, `+body`, and `+mono` (R-THM-1). */
export interface ThemeFonts {
  heading?: string;
  body?: string;
  mono?: string;
}

/** R-THM-2: the app's fonts for the theme tokens. */
export const APP_THEME_FONTS: Required<ThemeFonts> = {
  heading: 'OpenNote Sans',
  body: 'OpenNote Sans',
  mono: 'Atkinson Hyperlegible Mono',
};

export interface StyleContext {
  /** The app's own value of each style: its built-in set (R-STY-1's Default column). */
  readonly app: StyleSheetJson;
  readonly notebook: StyleSheetJson;
  /** The shown page's own sheet (R-STY-7), when it has one. */
  readonly page?: StyleSheetJson;
  /** The page's theme fonts, then the notebook's; missing fonts come from the app (R-THM-2). */
  readonly theme?: readonly (ThemeFonts | undefined)[];
}

/** The resolved look of a style: every look key with a value, and where each value came from. */
export interface ResolvedStyle {
  readonly name: string;
  readonly type: StyleType;
  /** The chain of names from the root to the style itself. */
  readonly chain: readonly string[];
  readonly values: Readonly<Partial<Record<LookKey, unknown>>>;
  /** The keys whose value comes from the notebook or the page, not from the app's defaults. */
  readonly own: ReadonlySet<LookKey>;
  readonly next: string;
}

/** Values every style starts from (R-STY-1 and R-PARA-1's Default columns). */
export const BASE_LOOK: Readonly<Partial<Record<LookKey, unknown>>> = {
  font: '+body',
  weight: 400,
  italic: false,
  underline: 'none',
  strike: 'none',
  caps: 'none',
  tracking: 0,
  textColor: 'theme:text',
  highlight: 'none',
  align: 'start',
  before: 0,
  after: 0,
  line: { rule: 'multiple', value: 1 },
};

/** A style's checked values with the page's keys over the notebook's (R-STY-7). */
function merged(ctx: StyleContext, name: string): StyleFormat | null {
  const notebook = ctx.notebook[name];
  const page = ctx.page?.[name];
  if (notebook === undefined && page === undefined) return null;
  return { ...readStyle(notebook), ...readStyle(page) };
}

/** Whether a style of that name exists in any layer. */
export function isDefined(ctx: StyleContext, name: string): boolean {
  return name in ctx.app || name in ctx.notebook || (ctx.page !== undefined && name in ctx.page);
}

/** A style's type and parent, from the highest layer that says. */
function header(ctx: StyleContext, name: string): { type: StyleType; basedOn?: string } {
  const user = merged(ctx, name);
  const app = readStyle(ctx.app[name]);
  const type = user?.type ?? app.type ?? 'paragraph';
  const explicit = user?.basedOn ?? app.basedOn;
  const basedOn = explicit ?? (type === 'paragraph' && name !== 'normal' ? 'normal' : undefined);
  return { type, basedOn };
}

/**
 * R-STY-4: the chain from the root to `name`. It stops at a name already seen (a cycle), at a name that isn't
 * defined, at a parent of the other type, and after 16 steps.
 */
export function styleChain(ctx: StyleContext, name: string): string[] {
  const chain = [name];
  const seen = new Set(chain);
  const type = header(ctx, name).type;
  let at = name;
  for (let step = 0; step < MAX_CHAIN; step++) {
    const parent = header(ctx, at).basedOn;
    if (!parent || seen.has(parent) || !isDefined(ctx, parent) || header(ctx, parent).type !== type) break;
    chain.push(parent);
    seen.add(parent);
    at = parent;
  }
  return chain.reverse();
}

function pick(format: StyleFormat, keys: readonly LookKey[] = LOOK_KEYS): Partial<Record<LookKey, unknown>> {
  const out: Partial<Record<LookKey, unknown>> = {};
  for (const key of keys) if (format[key] !== undefined) out[key] = format[key];
  return out;
}

/** A font with its theme token replaced (R-THM-2). */
export function themeFont(font: unknown, theme: StyleContext['theme']): unknown {
  if (typeof font !== 'string' || !font.startsWith('+')) return font;
  const key = font.slice(1) as keyof ThemeFonts;
  for (const layer of theme ?? []) {
    const named = layer?.[key];
    if (named) return named;
  }
  return APP_THEME_FONTS[key] ?? font;
}

/**
 * The look of style `name`. A paragraph style gets every look key. A character style gets only the run keys its
 * own chain sets, because it applies on top of the paragraph's look (R-STY-8).
 */
export function resolveStyle(ctx: StyleContext, name: string, options: { skipOwn?: boolean } = {}): ResolvedStyle {
  const chain = styleChain(ctx, name);
  const { type } = header(ctx, name);
  const keys = type === 'character' ? RUN_KEYS : LOOK_KEYS;
  const values: Record<string, unknown> = type === 'paragraph' ? { ...BASE_LOOK } : {};
  const own = new Set<LookKey>();
  chain.forEach((step, index) => {
    // The app's value of this step wins over what the notebook set on an earlier step, so it is not own.
    for (const [key, value] of Object.entries(pick(readStyle(ctx.app[step]), keys))) {
      values[key] = value;
      own.delete(key as LookKey);
    }
    if (options.skipOwn && index === chain.length - 1) return;
    const user = merged(ctx, step);
    if (!user) return;
    for (const [key, value] of Object.entries(pick(user, keys))) {
      values[key] = value;
      own.add(key as LookKey);
    }
  });
  if (values.font !== undefined) values.font = themeFont(values.font, ctx.theme);
  return { name, type, chain, values, own, next: nextStyle(ctx, name) };
}

/** The style after Enter at the end (R-STY-1 `next`): `normal` after titles and headings, else the style itself. */
export function nextStyle(ctx: StyleContext, name: string): string {
  const said = merged(ctx, name)?.next ?? readStyle(ctx.app[name]).next;
  if (said && isDefined(ctx, said)) return said;
  return /^(title|subtitle|h[1-9])$/.test(name) ? 'normal' : name;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * "Update style to match selection" (DESIGN.md 4.3): of the selection's effective values, only those that differ
 * from what the style would inherit without its own values. The style's other own keys are dropped.
 */
export function differingFromInherited(
  ctx: StyleContext,
  name: string,
  effective: Readonly<Partial<Record<LookKey, unknown>>>,
): Partial<Record<LookKey, unknown>> {
  const inherited = resolveStyle(ctx, name, { skipOwn: true }).values;
  const out: Partial<Record<LookKey, unknown>> = {};
  for (const key of LOOK_KEYS) {
    const value = effective[key];
    if (value === undefined) continue;
    const base = key === 'font' ? themeFont(inherited.font, ctx.theme) : inherited[key];
    if (!same(value, base)) out[key] = value;
  }
  return out;
}

/**
 * The styles a reader draws: every style of the app's set, then the first 64 valid names of the notebook and of the
 * page's sheet, in the order they are written (R-STY-3, R-STY-5). Other names stay in the file but are not drawn,
 * so a bad or hostile name never reaches the page's CSS, and a huge sheet costs no more than a full one.
 */
export function shownStyleNames(ctx: StyleContext): string[] {
  const names = new Set(Object.keys(ctx.app));
  for (const sheet of [ctx.notebook, ctx.page ?? {}]) {
    let taken = 0;
    for (const name of Object.keys(sheet)) {
      if (taken >= MAX_STYLES) break;
      if (!isStyleName(name)) continue;
      taken += 1;
      names.add(name);
    }
  }
  return [...names];
}

/** Every style a reader draws, resolved. */
export function resolveAll(ctx: StyleContext): Map<string, ResolvedStyle> {
  return new Map(shownStyleNames(ctx).map((name) => [name, resolveStyle(ctx, name)]));
}

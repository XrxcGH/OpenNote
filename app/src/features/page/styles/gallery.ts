// The data behind the style gallery and the Styles pane (text DESIGN.md 4.3 and 5.3): every style of the shown
// page, in gallery order, with its label, where it comes from, and its resolved look for the preview. The Home tab
// and the Format pane draw it; this file has no interface of its own.
import { t } from '../../../strings/t';
import type { MessageKey } from '../../../strings/t';
import { readStyle, styleLabel } from './model';
import type { LookKey, StyleType } from './model';
import { resolveStyle, shownStyleNames } from './resolve';
import type { StyleContext } from './resolve';

export type StyleSource = 'app' | 'notebook' | 'page';

export interface GalleryEntry {
  readonly name: string;
  readonly label: string;
  readonly type: StyleType;
  /** The highest layer that defines the style: the page, the notebook, or the app's set. */
  readonly source: StyleSource;
  readonly hidden: boolean;
  readonly order: number | null;
  readonly look: Readonly<Partial<Record<LookKey, unknown>>>;
}

/** The labels of the built-in styles: the version 1 ones from the dialog's strings, the newer ones from ours. */
const NEWER = new Set(['title', 'subtitle', 'citation', 'quote2', 'h7', 'h8', 'h9']);

export function builtInLabel(name: string): string {
  return NEWER.has(name) ? t(`textStyles.names.${name}` as MessageKey) : t(`editor.styles.names.${name}` as MessageKey);
}

function sourceOf(ctx: StyleContext, name: string): StyleSource {
  if (ctx.page && name in ctx.page) return 'page';
  return name in ctx.notebook ? 'notebook' : 'app';
}

/** Every style, in gallery order: by `order` where set, then by label (SPEC R-STY-1). */
export function galleryEntries(ctx: StyleContext, options: { includeHidden?: boolean } = {}): GalleryEntry[] {
  const entries = shownStyleNames(ctx).map((name): GalleryEntry => {
    const own = { ...readStyle(ctx.app[name]), ...readStyle(ctx.notebook[name]), ...readStyle(ctx.page?.[name]) };
    const resolved = resolveStyle(ctx, name);
    const raw = ctx.page?.[name] ?? ctx.notebook[name] ?? ctx.app[name];
    return {
      name,
      label: styleLabel(name, raw, builtInLabel),
      type: resolved.type,
      source: sourceOf(ctx, name),
      hidden: own.hidden === true,
      order: own.order ?? null,
      look: resolved.values,
    };
  });
  return entries
    .filter((entry) => options.includeHidden || !entry.hidden)
    .sort((a, b) => {
      if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
      if (a.order !== null && b.order === null) return -1;
      if (a.order === null && b.order !== null) return 1;
      return a.label.localeCompare(b.label, 'en-US');
    });
}

export interface StyleMenuItem {
  readonly id: string;
  readonly label: string;
  readonly checked: boolean;
  readonly separatorBefore?: boolean;
}

/**
 * The Apply style menu: the gallery's styles, then the hidden ones in a second group, so Headings 7 to 9 and other
 * hidden styles can be applied before the Format pane exists (DESIGN.md 4.3).
 */
export function applyMenuItems(ctx: StyleContext, current: string): StyleMenuItem[] {
  const all = galleryEntries(ctx, { includeHidden: true });
  const shown = all.filter((entry) => !entry.hidden);
  const hidden = all.filter((entry) => entry.hidden);
  return [...shown, ...hidden].map((entry, index) => ({
    id: entry.name,
    label: entry.label,
    checked: entry.name === current,
    ...(index === shown.length && shown.length > 0 ? { separatorBefore: true } : {}),
  }));
}

/** A short description of a style for its tooltip and accessible description: "Georgia, 16 pt, bold". */
export function lookSummary(look: GalleryEntry['look']): string {
  const parts: string[] = [];
  if (typeof look.font === 'string') parts.push(look.font);
  if (typeof look.sizePt === 'number') parts.push(`${look.sizePt} pt`);
  if (typeof look.weight === 'number' && look.weight >= 600) parts.push(t('textStyles.summary.bold'));
  if (look.italic === true) parts.push(t('textStyles.summary.italic'));
  return parts.join(', ');
}

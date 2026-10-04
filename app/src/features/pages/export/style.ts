// The look of an exported or printed page: a theme made from the brand's light values, the notebook's own named
// styles (format spec 4.1), and the stylesheet for the markup the renderers write. Export always uses the light
// values, so ink and paper print the same whatever theme the screen shows.
//
// No rule here draws with a border. Table lines, the quote bar, and callout edges use inset shadows and
// backgrounds, because a border snaps to device pixels on screen but not in print, and shifts layout (ADR 0006,
// rule 1).

import type { RuleGrid } from '../../../core/ruled';
import { tokens } from '../../../theme/tokens';
import { own } from '../layout/json';

export interface StyleSpec {
  readonly font?: string;
  /** Text size in page units, from 1 to 1000. */
  readonly size?: number;
  readonly color?: string;
  readonly spaceBefore?: number;
  readonly spaceAfter?: number;
  /** A multiple of the size, from 0.5 to 10. */
  readonly lineHeight?: number;
}

/** How a notebook shows each named style. Names of version 1 are `normal`, `h1` to `h6`, `title`, `quote`, and `code`. */
export type NotebookStyles = Readonly<Record<string, StyleSpec>>;

export interface DocTheme {
  readonly fonts: { readonly reading: string; readonly ui: string; readonly mono: string };
  readonly colors: {
    readonly text: string;
    readonly muted: string;
    readonly rule: string;
    readonly link: string;
    readonly tint: string;
    readonly accent: string;
    readonly page: string;
  };
  /** Pen name in lowercase to `#rrggbb`. */
  readonly pens: Readonly<Record<string, string>>;
  /** Highlighter name in lowercase to a CSS color with its transparency. */
  readonly highlighters: Readonly<Record<string, string>>;
  /** `@font-face` rules for the fonts the page uses. The caller supplies them, because their URLs depend on the host. */
  readonly fontFaces: string;
}

function highlighter(hex: string): string {
  const alpha = parseInt(hex.slice(7, 9) || 'ff', 16) / 255;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  // checks-disable-next-line brand-consistency: the color is computed from a brand token
  return `rgba(${r},${g},${b},${Math.round(alpha * 100) / 100})`;
}

/** The light theme from the brand tokens. */
export function lightTheme(fontFaces = ''): DocTheme {
  const c = tokens.color.light;
  return {
    fonts: { reading: tokens.font.reading, ui: tokens.font.ui, mono: tokens.font.mono },
    colors: {
      text: c.text.primary,
      muted: c.text.muted,
      rule: c.border.subtle,
      link: c.text.link,
      tint: c.surface.sunken,
      accent: c.accent.clay,
      page: c.surface.page,
    },
    pens: Object.fromEntries(tokens.ink.pens.map((p) => [p.name.toLowerCase(), p.light])),
    highlighters: Object.fromEntries(tokens.ink.highlighters.map((h) => [h.name.toLowerCase(), highlighter(h.light)])),
    fontFaces,
  };
}

const FONT = /^[\p{L}\p{N} ,'"._-]{1,200}$/u;
const HEX = /^#[0-9a-fA-F]{6}$/;
const PEN = /^[A-Za-z][A-Za-z0-9-]{0,31}$/;

function inRange(value: unknown, lo: number, hi: number): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= lo && value <= hi ? value : undefined;
}

/** Keeps the keys of a notebook's `styles` that are valid, and drops a value outside its range (format spec 4.1). */
export function readStyles(raw: unknown): NotebookStyles {
  const out: Record<string, StyleSpec> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
  for (const [name, value] of Object.entries(raw).slice(0, 64)) {
    if (typeof value !== 'object' || value === null) continue;
    const v = value as Record<string, unknown>;
    const spec: Record<string, string | number> = {};
    if (typeof v.font === 'string' && FONT.test(v.font)) spec.font = v.font;
    if (typeof v.color === 'string' && (HEX.test(v.color) || PEN.test(v.color))) spec.color = v.color;
    for (const [key, lo, hi] of [
      ['size', 1, 1000],
      ['spaceBefore', 0, 1000],
      ['spaceAfter', 0, 1000],
      ['lineHeight', 0.5, 10],
    ] as const) {
      const number = inRange(v[key], lo, hi);
      if (number !== undefined) spec[key] = number;
    }
    out[name] = spec;
  }
  return out;
}

interface Resolved {
  readonly font: string;
  readonly size: number;
  readonly color: string;
  readonly before: number;
  readonly after: number;
  readonly line: number;
}

class Styler {
  constructor(
    private readonly theme: DocTheme,
    private readonly styles: NotebookStyles,
  ) {}

  private color(value: string | undefined, fallback: string): string {
    if (value === undefined) return fallback;
    return HEX.test(value) ? value : (own(this.theme.pens, value.toLowerCase()) ?? fallback);
  }

  /** A style with the notebook's values over the defaults. */
  resolve(name: string, base: Resolved): Resolved {
    const s = this.styles[name] ?? {};
    return {
      font: s.font ? `${s.font}, ${base.font}` : base.font,
      size: s.size ?? base.size,
      color: this.color(s.color, base.color),
      before: s.spaceBefore ?? base.before,
      after: s.spaceAfter ?? base.after,
      line: s.lineHeight ?? base.line,
    };
  }
}

function type(r: Resolved): string {
  return `font-family:${r.font};font-size:${r.size}px;line-height:${r.line};color:${r.color};`;
}

function rule(selector: string, r: Resolved, extra = ''): string {
  return `${selector}{${type(r)}margin:${r.before}px 0 ${r.after}px;${extra}}`;
}

/** Default heading sizes: the brand's title scale, then the body size for the smallest headings. */
const HEADINGS: readonly (readonly [string, number, number])[] = [
  ['h1', 30, 1.27],
  ['h2', 24, 1.33],
  ['h3', 20, 1.4],
  ['h4', 17, 1.41],
  ['h5', 16, 1.5],
  ['h6', 16, 1.5],
];

/** Ruled paper's grid and the font metric its text is shifted by: see `features/page/layout/rules.ts`. */
export interface Ruled {
  readonly grid: RuleGrid;
  /** The reading font's ascent minus its descent, in ems. */
  readonly metric: number;
}

/**
 * The rules that lay a page's text out on ruled paper, the same as the screen does: every line is a whole number of
 * rules tall with its baseline on a rule, and what does not come in lines is rounded up to whole rules.
 */
function ruledCss({ grid, metric }: Ruled): string[] {
  const shift = 'calc((1lh - var(--ruled-m) * 1em) / 2)';
  const lines = 'p,h1,h2,h3,h4,h5,h6,.page-title,.callout-title,summary,li:not(:has(>ul,>ol,>p))';
  return [
    `:root{--ruled:${grid.step}px;--ruled-m:${metric}}`,
    `body{line-height:var(--ruled)}`,
    `p,ul,ol,li,blockquote,pre,figure,table,details,.callout,.tags,h1,h2,h3,h4,h5,h6,.page-title{margin-top:0;margin-bottom:0}`,
    `${lines}{line-height:round(up,1.25em,var(--ruled));padding-top:${shift};margin-bottom:calc(-1 * ${shift})}`,
    `li>:is(ul,ol){margin-top:calc(-1 * ${shift})}`,
    `span,a,code,mark,em,strong,s,u,.link{line-height:0}`,
    `.callout,pre,th,td{padding-top:0;padding-bottom:0}`,
    `.callout :is(p,.callout-title,summary,li){padding-top:0;margin-bottom:0}`,
    `pre,pre code{line-height:var(--ruled)}`,
    `hr{height:var(--ruled);margin:0;background:none;box-shadow:inset 0 -1px 0 var(--rule)}`,
  ];
}

/** The stylesheet for the markup of `renderHtml` and the blocks around it. */
export function documentCss(theme: DocTheme, notebookStyles: NotebookStyles = {}, ruled: Ruled | null = null): string {
  const { colors: c, fonts: f } = theme;
  const styler = new Styler(theme, notebookStyles);
  const normal = styler.resolve('normal', {
    font: f.reading,
    size: 16,
    color: c.text,
    before: 0,
    after: 8,
    line: 1.625,
  });
  const heading = (name: string, size: number, line: number, weight: number) =>
    rule(
      name,
      styler.resolve(name, { ...normal, size, line, before: 18, after: 6 }),
      `font-weight:${weight};break-after:avoid;`,
    );
  const quote = styler.resolve('quote', { ...normal, color: c.muted, after: 8 });
  const code = styler.resolve('code', { ...normal, font: f.mono, size: 14, line: 1.57 });
  const title = styler.resolve('title', { ...normal, font: f.reading, size: 36, line: 1.22, before: 0, after: 12 });
  const rules = [
    `:root{--text:${c.text};--muted:${c.muted};--rule:${c.rule};--link:${c.link};--tint:${c.tint};--accent:${c.accent};--page:${c.page}}`,
    ...Object.entries(theme.pens).map(([n, v]) => `.pen-${n}{color:${v}}`),
    ...Object.entries(theme.highlighters).map(([n, v]) => `.hl-${n}{background:${v};color:inherit}`),
    `*{box-sizing:border-box}`,
    `body{margin:0;${type(normal)}}`,
    rule('p,ul,ol,figure,table,.callout,details', normal),
    rule('.page-title', title, 'font-weight:700;'),
    ...HEADINGS.map(([name, size, line]) => heading(name, size, line, name === 'h6' ? 600 : 700)),
    `.tags{margin:0 0 16px;color:var(--muted);font-family:${f.ui};font-size:14px;line-height:1.5}`,
    `ul,ol{padding-inline-start:1.5em}li{margin:0 0 4px}li>ul,li>ol{margin:4px 0 0}`,
    `ul.tasks{list-style:none;padding-inline-start:0}ul.tasks ul.tasks{padding-inline-start:1.5em}`,
    `li.task{display:flex;gap:8px;align-items:baseline}li.task>.box+*{flex:1 1 auto;min-width:0}`,
    `.box{display:inline-block;width:14px;height:14px;flex:none;border-radius:3px;position:relative;top:2px;` +
      `box-shadow:inset 0 0 0 1.5px var(--muted);background:var(--page)}`,
    `.box-done{box-shadow:inset 0 0 0 1.5px var(--accent);background:var(--accent)}`,
    `.box-done::after{content:"";position:absolute;left:4px;top:1px;width:4px;height:8px;transform:rotate(45deg);` +
      `box-shadow:inset -2px -2px 0 var(--page)}`,
    `.task-done{color:var(--muted)}`,
    rule('blockquote', quote, 'padding-inline-start:16px;box-shadow:inset 3px 0 0 var(--rule);'),
    `blockquote>:last-child{margin-bottom:0}`,
    rule(
      'pre',
      code,
      `padding:12px 14px;background:var(--tint);border-radius:6px;white-space:pre-wrap;overflow-wrap:anywhere;`,
    ),
    `code{font-family:${f.mono};font-size:0.9em}pre code{font-size:inherit}`,
    `a,.link{color:var(--link);text-decoration:underline}`,
    `mark{color:inherit}sub,sup{line-height:0}`,
    `hr{height:1px;margin:16px 0;padding:0;background:var(--rule)}`,
    `.size-small{font-size:0.85em}.size-large{font-size:1.25em}.size-xlarge{font-size:1.6em}`,
    `.callout{padding:10px 14px;border-radius:6px;background:var(--tint);box-shadow:inset 3px 0 0 var(--accent)}`,
    `.callout>:last-child{margin-bottom:0}.callout-title,summary{font-weight:700;font-family:${f.ui}}`,
    `table{border-collapse:separate;border-spacing:0;max-width:100%;table-layout:fixed;box-shadow:inset 1px 1px 0 var(--rule)}`,
    `th,td{padding:6px 10px;text-align:start;vertical-align:top;overflow-wrap:anywhere;` +
      `box-shadow:inset -1px -1px 0 var(--rule)}`,
    `th{background:var(--tint);font-weight:700;font-family:${f.ui}}`,
    `figure{margin:0 0 8px}figure img,.block img{max-width:100%;height:auto}figcaption{color:var(--muted);font-size:14px}`,
    `.ink{display:block;max-width:100%;height:auto}`,
    `img{display:block}p img{display:inline-block}`,
  ];
  if (ruled) rules.push(...ruledCss(ruled));
  return `${theme.fontFaces}\n${rules.join('\n')}\n`;
}

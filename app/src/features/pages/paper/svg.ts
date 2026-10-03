// Turns a sheet's paper paths into one SVG element. Colors come in as design token names, such as "border.subtle".
// They leave as CSS custom properties, so the markup follows the theme on screen and prints with the light values.

import type { Rect } from '../pagination/geometry';
import { own } from '../layout/json';
import { fmt } from './canvas';
import { STROKE, type PageBackground, type PaperLabel, type PaperPaths } from './types';

export interface PaperStyle {
  /** The token for each kind of line when the page uses the theme's rule color, and for labels and tints. */
  readonly tokens: {
    readonly rule: string;
    readonly strong: string;
    readonly margin: string;
    readonly label: string;
    readonly tint: string;
  };
  /** Token names for the pen palette, keyed by the pen name a page stores in `background.color`. */
  readonly palette?: Readonly<Record<string, string>>;
  /** The token for the label font, such as "font.ui". */
  readonly fontToken: string;
  /** Label text sizes in page units. */
  readonly labelSizes: { readonly caption: number; readonly small: number };
}

/** Pen colors and custom colors show through at this share of full strength, so they read as faint rulings. */
export const PEN_OPACITY = 0.45;
/** The margin line is the accent color at this share of full strength. */
export const MARGIN_OPACITY = 0.35;

const HEX = /^#[0-9a-f]{3,8}$/i;
const TOKEN = /^[A-Za-z][A-Za-z0-9.]*$/;
const kebab = (word: string) => word.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** The CSS custom property for a token name: "border.subtle" gives var(--color-border-subtle). */
export function tokenVar(name: string): string {
  if (!TOKEN.test(name)) throw new Error(`Not a token name: ${name}`);
  const [group, ...rest] = name.split('.');
  const tail = rest.map(kebab).join('-');
  return group === 'font' ? `var(--font-${tail})` : `var(--color-${kebab(group)}-${tail})`;
}

interface Ink {
  readonly rule: string;
  readonly strong: string;
  readonly opacity: number;
}

/** The color of the page's lines: the rule tokens for `rule`, else the pen or custom color at a fixed share. */
function inkOf(bg: PageBackground, style: PaperStyle): Ink {
  const plain = { rule: tokenVar(style.tokens.rule), strong: tokenVar(style.tokens.strong), opacity: 1 };
  const color = bg.color;
  if (color === undefined || color === 'rule') return plain;
  const pen = own(style.palette, color);
  if (pen !== undefined) return { rule: tokenVar(pen), strong: tokenVar(pen), opacity: PEN_OPACITY };
  if (HEX.test(color)) return { rule: color, strong: color, opacity: PEN_OPACITY };
  return plain;
}

function escapeXml(text: string): string {
  const map: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return text.replace(/[&<>"]/g, (ch) => map[ch]);
}

function pathTag(d: string, css: string): string {
  return d ? `<path d="${d}" fill="none" style="${css}"/>` : '';
}

function stroke(color: string, width: number, opacity = 1): string {
  return `stroke:${color};stroke-width:${width}` + (opacity < 1 ? `;stroke-opacity:${opacity}` : '');
}

interface Tokens {
  readonly tint: string;
  readonly label: string;
  readonly font: string;
}

function rectTag(r: Rect, tokens: Tokens): string {
  const box = `x="${fmt(r.x)}" y="${fmt(r.y)}" width="${fmt(r.w)}" height="${fmt(r.h)}"`;
  return `<rect ${box} style="fill:${tokens.tint}"/>`;
}

function textTag(l: PaperLabel, style: PaperStyle, tokens: Tokens): string {
  const css = `fill:${tokens.label};font-family:${tokens.font}`;
  const at = `x="${fmt(l.x)}" y="${fmt(l.y)}" font-size="${style.labelSizes[l.size]}"`;
  return `<text ${at} style="${css}">${escapeXml(l.text)}</text>`;
}

/** One `<svg>` for a sheet or a tile. It is hidden from assistive technology, because paper is decoration. */
export function paperSvg(paths: PaperPaths, view: Rect, bg: PageBackground, style: PaperStyle): string {
  const ink = inkOf(bg, style);
  const tokens = {
    tint: tokenVar(style.tokens.tint),
    label: tokenVar(style.tokens.label),
    font: tokenVar(style.fontToken),
  };
  const parts = [
    ...paths.tints.map((r) => rectTag(r, tokens)),
    pathTag(paths.rules, stroke(ink.rule, STROKE.rule, ink.opacity)),
    pathTag(paths.strong, stroke(ink.strong, STROKE.strong, ink.opacity)),
    pathTag(paths.dots, `${stroke(ink.rule, STROKE.strong, ink.opacity)};stroke-linecap:round`),
    pathTag(paths.margin, stroke(tokenVar(style.tokens.margin), STROKE.strong, MARGIN_OPACITY)),
    ...paths.labels.map((l) => textTag(l, style, tokens)),
  ];
  const box = `${fmt(view.x)} ${fmt(view.y)} ${fmt(view.w)} ${fmt(view.h)}`;
  const size = `width="${fmt(view.w)}" height="${fmt(view.h)}"`;
  const open = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}" ${size} aria-hidden="true" focusable="false">`;
  return `${open}${parts.join('')}</svg>`;
}

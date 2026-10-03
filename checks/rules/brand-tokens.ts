// Validates brand/tokens.json. Every theme defines the same tokens, and text meets its contrast target in every
// theme. The forced-colors map names system colors for existing tokens, and motion stays within the limits set in
// docs/BRAND.md. Contrast pairs may name pens and highlighters (ink.pens.<Name>, ink.highlighters.<Name>), which
// resolve to their light or dark value per theme. A pair may also composite a translucent background over a color.

import type { Finding, Rule, SourceFile } from '../types.ts';
import { numberSetting } from '../config.ts';
import { reporter } from './helpers.ts';

interface ContrastPair {
  fg: string;
  bg: string;
  min: number;
  /** Composites a translucent `bg`, such as a highlighter, over this color first. */
  over?: string;
}

interface InkColor {
  name: string;
  [theme: string]: string;
}

export interface Tokens {
  color: Record<string, Record<string, unknown>>;
  contrast?: ContrastPair[];
  forcedColors?: Record<string, unknown>;
  ink?: { pens?: InkColor[]; highlighters?: InkColor[] };
  motion?: { duration?: Record<string, number> };
}

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
const INK = /^ink\.(pens|highlighters)\.(.+)$/;

/** The CSS system color keywords a Windows contrast theme supplies (CSS Color Module Level 4). */
export const SYSTEM_COLORS: readonly string[] = [
  'AccentColor AccentColorText ActiveText ButtonBorder ButtonFace ButtonText Canvas CanvasText Field FieldText',
  'GrayText Highlight HighlightText LinkText Mark MarkText SelectedItem SelectedItemText VisitedText',
]
  .join(' ')
  .split(' ');

export const brandTokens: Rule = {
  id: 'brand-tokens',
  description: 'Design tokens: theme parity, valid colors, WCAG contrast, forced colors, and motion limits.',
  appliesTo: (file) => file.path.endsWith('brand/tokens.json'),
  check(file, ctx) {
    const report = reporter('brand-tokens', file);
    let tokens: Tokens;
    try {
      tokens = JSON.parse(file.text) as Tokens;
    } catch (error) {
      return [report(1, `Invalid JSON: ${(error as Error).message}`)];
    }
    const maxMs = numberSetting(ctx.settings, 'maxDurationMs', 400);
    return [
      ...themeFindings(file, tokens),
      ...contrastFindings(file, tokens),
      ...forcedColorFindings(file, tokens),
      ...motionFindings(file, tokens, maxMs),
    ];
  },
};

export function flatten(object: Record<string, unknown>, prefix = ''): Map<string, unknown> {
  const result = new Map<string, unknown>();
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      flatten(value as Record<string, unknown>, path).forEach((v, k) => result.set(k, v));
    } else {
      result.set(path, value);
    }
  }
  return result;
}

function themeFindings(file: SourceFile, tokens: Tokens): Finding[] {
  const report = reporter('brand-tokens', file);
  const findings: Finding[] = [];
  const themes = Object.entries(tokens.color ?? {}).map(([name, values]) => ({ name, values: flatten(values) }));
  const allKeys = new Set(themes.flatMap((t) => [...t.values.keys()]));
  for (const theme of themes) {
    allKeys.forEach((key) => {
      if (!theme.values.has(key))
        findings.push(report(lineOf(file, `"${theme.name}"`), `Theme "${theme.name}" is missing color "${key}".`));
    });
    theme.values.forEach((value, key) => {
      if (typeof value !== 'string' || !HEX.test(value))
        findings.push(
          report(lineOf(file, String(value)), `"${theme.name}.${key}" must be a #RRGGBB or #RRGGBBAA color.`),
        );
      else if (/^#(000000|ffffff)$/i.test(value) && /^(surface|text)\./.test(key)) {
        findings.push(
          report(
            lineOf(file, value),
            `"${theme.name}.${key}" is pure black or white. The brand guide (docs/BRAND.md) uses softer tones.`,
            'warning',
          ),
        );
      }
    });
  }
  return findings;
}

/** A color path's value in one theme: a color token, or a pen or highlighter by name. */
export function resolveColor(tokens: Tokens, theme: string, path: string): string | undefined {
  const ink = INK.exec(path);
  const value = ink
    ? tokens.ink?.[ink[1] as 'pens' | 'highlighters']?.find((entry) => entry.name === ink[2])?.[theme]
    : flatten(tokens.color?.[theme] ?? {}).get(path);
  return typeof value === 'string' ? value : undefined;
}

function contrastFindings(file: SourceFile, tokens: Tokens): Finding[] {
  const report = reporter('brand-tokens', file);
  const findings: Finding[] = [];
  for (const theme of Object.keys(tokens.color ?? {})) {
    for (const pair of tokens.contrast ?? []) {
      const [fg, bg] = [resolveColor(tokens, theme, pair.fg), resolveColor(tokens, theme, pair.bg)];
      const under = pair.over === undefined ? undefined : resolveColor(tokens, theme, pair.over);
      const line = lineOf(file, `"${pair.fg}"`);
      if (fg === undefined || bg === undefined || (pair.over !== undefined && under === undefined)) {
        findings.push(report(line, `Contrast pair ${describe(pair)} doesn't exist in theme "${theme}".`));
        continue;
      }
      const ratio = contrastRatio(fg, bg, under);
      if (ratio < pair.min)
        findings.push(
          report(line, `${theme}: ${describe(pair)} has contrast ${ratio.toFixed(2)}:1, needs ${pair.min}:1.`),
        );
    }
  }
  return findings;
}

function describe(pair: ContrastPair): string {
  return pair.over ? `${pair.fg} on ${pair.bg} over ${pair.over}` : `${pair.fg} on ${pair.bg}`;
}

/** Every key names a color token, and every value is a CSS system color keyword. */
function forcedColorFindings(file: SourceFile, tokens: Tokens): Finding[] {
  const report = reporter('brand-tokens', file);
  const known = new Set(Object.values(tokens.color ?? {}).flatMap((theme) => [...flatten(theme).keys()]));
  return Object.entries(tokens.forcedColors ?? {}).flatMap(([path, value]) => {
    const line = lineOf(file, `"${path}": "${String(value)}"`);
    const findings: Finding[] = [];
    if (!known.has(path)) findings.push(report(line, `forcedColors names "${path}", which isn't a color token.`));
    if (typeof value !== 'string' || !SYSTEM_COLORS.includes(value))
      findings.push(
        report(line, `forcedColors "${path}" must be a CSS system color such as Canvas or Highlight, not ${value}.`),
      );
    return findings;
  });
}

function motionFindings(file: SourceFile, tokens: Tokens, maxMs: number): Finding[] {
  const report = reporter('brand-tokens', file);
  return Object.entries(tokens.motion?.duration ?? {})
    .filter(([, ms]) => typeof ms !== 'number' || ms > maxMs)
    .map(([name, ms]) => report(lineOf(file, `"${name}"`), `Duration "${name}" is ${ms}ms; the limit is ${maxMs}ms.`));
}

function lineOf(file: SourceFile, needle: string): number {
  const index = file.lines.findIndex((l) => l.includes(needle));
  return index === -1 ? 1 : index + 1;
}

/**
 * WCAG 2 contrast ratio. A translucent foreground is blended over the background first. With `under`, a
 * translucent background (a highlighter, for example) is first blended over that opaque color.
 */
export function contrastRatio(fgHex: string, bgHex: string, under?: string): number {
  const bg = under === undefined ? rgb(bgHex) : blend(bgHex, rgb(under));
  const fg = blend(fgHex, bg);
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** A color painted over opaque channels, blended by its alpha when it has one. */
function blend(topHex: string, bottom: number[]): number[] {
  const alpha = topHex.length === 9 ? parseInt(topHex.slice(7, 9), 16) / 255 : 1;
  return rgb(topHex).map((c, i) => c * alpha + bottom[i] * (1 - alpha));
}

function rgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

function luminance(channels: number[]): number {
  const [r, g, b] = channels.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

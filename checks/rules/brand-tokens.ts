// Validates brand/tokens.json: every theme defines the same tokens, text meets its contrast
// target in every theme, and motion stays within the limits set in docs/BRAND.md.

import type { Finding, Rule, SourceFile } from '../types.ts';
import { numberSetting } from '../config.ts';
import { reporter } from './helpers.ts';

interface ContrastPair {
  fg: string;
  bg: string;
  min: number;
}

interface Tokens {
  color: Record<string, Record<string, unknown>>;
  contrast?: ContrastPair[];
  motion?: { duration?: Record<string, number> };
}

const HEX = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

export const brandTokens: Rule = {
  id: 'brand-tokens',
  description: 'Design tokens: theme parity, valid colors, WCAG contrast and motion limits.',
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
    return [...themeFindings(file, tokens), ...contrastFindings(file, tokens), ...motionFindings(file, tokens, maxMs)];
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

function contrastFindings(file: SourceFile, tokens: Tokens): Finding[] {
  const report = reporter('brand-tokens', file);
  const findings: Finding[] = [];
  for (const [themeName, values] of Object.entries(tokens.color ?? {})) {
    const flat = flatten(values);
    for (const pair of tokens.contrast ?? []) {
      const fg = flat.get(pair.fg);
      const bg = flat.get(pair.bg);
      const line = lineOf(file, `"${pair.fg}"`);
      if (typeof fg !== 'string' || typeof bg !== 'string') {
        findings.push(report(line, `Contrast pair ${pair.fg} on ${pair.bg} doesn't exist in theme "${themeName}".`));
        continue;
      }
      const ratio = contrastRatio(fg, bg);
      if (ratio < pair.min)
        findings.push(
          report(
            line,
            `${themeName}: ${pair.fg} on ${pair.bg} has contrast ${ratio.toFixed(2)}:1, needs ${pair.min}:1.`,
          ),
        );
    }
  }
  return findings;
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

/** WCAG 2 contrast ratio. A translucent foreground is blended over the background first. */
export function contrastRatio(fgHex: string, bgHex: string): number {
  const bg = rgb(bgHex);
  const fgRaw = rgb(fgHex);
  const alpha = fgHex.length === 9 ? parseInt(fgHex.slice(7, 9), 16) / 255 : 1;
  const fg = fgRaw.map((c, i) => c * alpha + bg[i] * (1 - alpha));
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return (l1 + 0.05) / (l2 + 0.05);
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

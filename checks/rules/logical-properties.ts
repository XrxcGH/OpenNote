// Logical CSS properties in UI code (ARCHITECTURE.md section 4.6), so a right-to-left language later needs only
// dir="rtl". Flags physical properties and values in style sheets and in inline React styles, as warnings.

import type { Finding, Rule, SourceFile } from '../types.ts';
import { stringList } from '../config.ts';
import { matchesAny } from '../glob.ts';
import { reporter } from './helpers.ts';

const DEFAULT_INCLUDE = ['app/src/**/*.{css,scss,tsx}'];
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

const SIDES: Record<string, string> = {
  left: 'inline-start',
  right: 'inline-end',
  top: 'block-start',
  bottom: 'block-end',
};

/** Each physical property and its logical replacement. */
export const PHYSICAL: ReadonlyMap<string, string> = new Map([
  ...Object.entries(SIDES).map(([side, logical]): [string, string] => [side, `inset-${logical}`]),
  ...['margin', 'padding', 'scroll-margin', 'scroll-padding'].flatMap((box) =>
    Object.entries(SIDES).map(([side, logical]): [string, string] => [`${box}-${side}`, `${box}-${logical}`]),
  ),
  ...['', '-color', '-style', '-width'].flatMap((part) =>
    Object.entries(SIDES).map(([side, logical]): [string, string] => [
      `border-${side}${part}`,
      `border-${logical}${part}`,
    ]),
  ),
  ['border-top-left-radius', 'border-start-start-radius'],
  ['border-top-right-radius', 'border-start-end-radius'],
  ['border-bottom-left-radius', 'border-end-start-radius'],
  ['border-bottom-right-radius', 'border-end-end-radius'],
  ['width', 'inline-size'],
  ['height', 'block-size'],
  ['min-width', 'min-inline-size'],
  ['max-width', 'max-inline-size'],
  ['min-height', 'min-block-size'],
  ['max-height', 'max-block-size'],
]);

/** Properties whose physical values have logical ones. */
const PHYSICAL_VALUES: Record<string, Record<string, string>> = {
  'text-align': { left: 'start', right: 'end' },
  float: { left: 'inline-start', right: 'inline-end' },
  clear: { left: 'inline-start', right: 'inline-end' },
};

// A declaration starts a line, or follows an opening brace or a semicolon. Custom properties never match.
const DECLARATION = /(?:^|[{;])\s*([a-z-]+)\s*:\s*([^;{}]*)/g;
// An inline style object, such as style={{ left: x }}, on one line.
const INLINE_STYLE = /style=\{\{([^}]*)\}\}/g;
const STYLE_KEY = /(?:^|[,{])\s*([A-Za-z]+)\s*:\s*([^,]*)/g;

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const logicalProperties: Rule = {
  id: 'logical-properties',
  description: 'UI styles use logical properties (inline and block), not left, right, top, and bottom.',
  appliesTo: () => true,
  check(file, ctx) {
    const include = stringList(ctx.settings, 'include');
    if (!matchesAny(file.path, include.length ? include : DEFAULT_INCLUDE)) return [];
    const css = /\.s?css$/.test(file.path);
    const findings: Finding[] = [];
    file.lines.forEach((raw, i) => {
      if (COMMENT_LINE.test(raw)) return;
      const declarations = css ? cssDeclarations(raw) : inlineDeclarations(raw);
      findings.push(...declarations.flatMap(([name, value]) => problems(file, i + 1, name, value)));
    });
    return findings;
  },
};

function cssDeclarations(raw: string): [string, string][] {
  return [...raw.matchAll(DECLARATION)].map((match) => [match[1], match[2].trim()]);
}

function inlineDeclarations(raw: string): [string, string][] {
  return [...raw.matchAll(INLINE_STYLE)].flatMap((style) =>
    [...style[1].matchAll(STYLE_KEY)].map((match): [string, string] => [kebab(match[1]), match[2].trim()]),
  );
}

function problems(file: SourceFile, line: number, name: string, value: string): Finding[] {
  const report = reporter('logical-properties', file);
  const logical = PHYSICAL.get(name);
  if (logical) {
    return [
      report(line, `Physical property "${name}". Use "${logical}", which follows the writing direction.`, 'warning'),
    ];
  }
  const keyword = /^['"]?([a-z-]+)['"]?\s*(?:!important)?$/.exec(value)?.[1];
  const replacement = keyword ? PHYSICAL_VALUES[name]?.[keyword] : undefined;
  if (!replacement) return [];
  return [report(line, `"${name}: ${keyword}" is physical. Use "${name}: ${replacement}".`, 'warning')];
}

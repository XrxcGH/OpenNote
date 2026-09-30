// Brand consistency in UI code. Colors, fonts, motion, and layering must come from design tokens
// (see BRAND.md and brand/tokens.json). That way the look can change in one place later.

import type { Finding, Rule, SourceFile } from '../types.ts';
import { numberSetting, stringList } from '../config.ts';
import { matchesAny } from '../glob.ts';
import { reporter } from './helpers.ts';

const DEFAULT_INCLUDE = ['app/src/**/*.{ts,tsx,css,scss}'];
// Only the generated token files hold raw values. Hand-written theme code is checked like any other UI code.
const DEFAULT_TOKEN_FILES = ['app/src/theme/tokens.{css,ts}', 'brand/**'];
const COLOR_FUNCTIONS = 'rgba?|hsla?|hwb|oklch|oklab|lab|lch';
// CSS function names ignore case, and only CSS uses color() as a color. In TypeScript, color() may be any function.
const RAW_COLOR = {
  css: new RegExp(`(^|[\\s:'"\`(,=])(#[0-9a-f]{3,8}\\b|(?:${COLOR_FUNCTIONS}|color)\\()`, 'i'),
  code: new RegExp(`(^|[\\s:'"\`(,=])(#[0-9a-fA-F]{3,8}\\b|(?:${COLOR_FUNCTIONS})\\()`),
};
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*)/;

// The 148 CSS named colors. Keywords such as transparent, currentColor, and inherit stay allowed.
// CSS matches them in any case. In TypeScript only lowercase counts, because a capitalized name such as
// 'Indigo' is usually a pen name or a label.
const NAMED_COLORS = [
  'aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood',
  'cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray',
  'darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen',
  'darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue',
  'firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew',
  'hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan',
  'lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray',
  'lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue',
  'mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred',
  'midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid',
  'palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple',
  'rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue',
  'slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white',
  'whitesmoke yellow yellowgreen',
].join(' ');
const NAMED_COLOR_SOURCE = `(^|[\\s'"\`(,])(?:${NAMED_COLORS.replaceAll(' ', '|')})(?=$|[\\s'"\`),;!])`;
const NAMED_COLOR = { css: new RegExp(NAMED_COLOR_SOURCE, 'i'), code: new RegExp(NAMED_COLOR_SOURCE) };
// A property that takes a color: a CSS declaration, an object key, a JSX attribute such as fill="white", or an
// assignment such as ctx.fillStyle = 'white'. Data attributes hold app state, not styles, so they are skipped.
const COLOR_WORDS = 'color|background|border|outline|fill|stroke|shadow|caret|accent|decoration|column-?rule';
const COLOR_PROPERTY = new RegExp(
  `(?<!\\b(?:data-|dataset\\.)[\\w-]*)(?:${COLOR_WORDS})[\\w-]*(?:['"]?\\s*:(?!:)|=(?=\\{)|\\s*=\\s*(?=["'\`]))`,
  'gi',
);
// In TypeScript only a string counts, so fontFamily: tokens.font.ui passes.
const RAW_FONT_FAMILY = {
  css: /font-family\s*:\s*(?!\s*var\()/i,
  code: /font-?family['"]?\s*:\s*['"`](?!\s*(?:var\(|\$\{))/i,
};
// The font shorthand as a declaration or object key, or assigned as in ctx.font = '14px Arial'.
const FONT_SHORTHAND = /(?:^|[\s{;'"`])font['"]?\s*:(?!:)|\.font\s*=(?![=>])/gi;
// A property value ends at a semicolon, a closing brace, the next object key, or the next JSX attribute.
const VALUE_END = /[;}]|,\s*['"]?[A-Za-z_$][\w$-]*['"]?\s*:|\s[\w:-]+=["'{]/;
// CSS-wide keywords, plus style keywords that have no token.
const FONT_ALLOWED =
  /\b(?:inherit|initial|unset|revert-layer|revert|normal|italic|oblique|small-caps)\b|!important|['"`,/]/gi;
const STRING_START = /^\s*(['"`])(.*?)\1/;

export const brandConsistency: Rule = {
  id: 'brand-consistency',
  description: 'UI code must use design tokens for colors, fonts, durations, z-index, and font sizes.',
  appliesTo: () => true,
  check(file, ctx) {
    const include = stringList(ctx.settings, 'include');
    const tokenFiles = stringList(ctx.settings, 'tokenFiles');
    if (!matchesAny(file.path, include.length ? include : DEFAULT_INCLUDE)) return [];
    if (matchesAny(file.path, tokenFiles.length ? tokenFiles : DEFAULT_TOKEN_FILES)) return [];
    const maxMs = numberSetting(ctx.settings, 'maxDurationMs', 400);
    const findings: Finding[] = [];
    file.lines.forEach((raw, i) => {
      if (!COMMENT_LINE.test(raw)) findings.push(...checkLine(file, raw, i + 1, maxMs));
    });
    return findings;
  },
};

function checkLine(file: SourceFile, raw: string, line: number, maxMs: number): Finding[] {
  const report = reporter('brand-consistency', file);
  const findings: Finding[] = [];
  const css = /\.s?css$/.test(file.path);
  if ((css ? RAW_COLOR.css : RAW_COLOR.code).test(raw) || hasNamedColor(raw, css)) {
    findings.push(report(line, 'Raw color value. Use a color token from brand/tokens.json.'));
  }
  if ((css ? RAW_FONT_FAMILY.css : RAW_FONT_FAMILY.code).test(raw)) {
    findings.push(report(line, 'Raw font family. Use a font token.'));
  }
  if (hasRawFontShorthand(raw, css)) findings.push(report(line, 'Raw font shorthand. Use font and type tokens.'));
  if (/z-?index\s*:\s*['"]?-?\d+/i.test(raw)) findings.push(report(line, 'Raw z-index. Use a layer token.'));
  if (/font-?size\s*:\s*['"]?\d+(\.\d+)?(px)?['"]?\s*[,;}]?/i.test(raw) && !/var\(/.test(raw)) {
    findings.push(report(line, 'Raw font size. Use a type-scale token.', 'warning'));
  }
  findings.push(...durationFindings(file, raw, line, maxMs));
  return findings;
}

/** Values of the properties matched by `pattern` on this line. */
function propertyValues(raw: string, pattern: RegExp): string[] {
  return [...raw.matchAll(pattern)].map((match) => raw.slice(match.index + match[0].length).split(VALUE_END)[0]);
}

function hasNamedColor(raw: string, css: boolean): boolean {
  const named = css ? NAMED_COLOR.css : NAMED_COLOR.code;
  return propertyValues(raw, COLOR_PROPERTY).some((value) => named.test(value));
}

/**
 * A font shorthand is raw if anything is left after removing var() tokens, template interpolations such as
 * ${size}px, and keywords such as inherit and italic. In TypeScript, `font:` is often a type or a role name such
 * as 'reading', so a string needs at least two parts, such as '14px Arial', to count.
 */
function hasRawFontShorthand(raw: string, css: boolean): boolean {
  const line = raw.replace(/\$\{[^{}]*\}[\w%]*/g, 'var()');
  return propertyValues(line, FONT_SHORTHAND).some((value) => {
    const text = css ? value : STRING_START.exec(value)?.[2];
    if (text === undefined || (!css && text.trim().split(/\s+/).length < 2)) return false;
    return rawFontWords(text) > 0;
  });
}

/** Counts the words in a font value that are not var() tokens or allowed keywords. */
function rawFontWords(value: string): number {
  let rest = value;
  // Removes var() calls from the inside out, so fallbacks such as var(--a, var(--b)) go too.
  while (/var\([^()]*\)/.test(rest)) rest = rest.replace(/var\([^()]*\)/g, '');
  return rest.replace(FONT_ALLOWED, ' ').split(/\s+/).filter(Boolean).length;
}

function durationFindings(file: SourceFile, raw: string, line: number, maxMs: number): Finding[] {
  if (!/(transition|animation|duration|delay)/i.test(raw)) return [];
  const report = reporter('brand-consistency', file);
  const findings: Finding[] = [];
  for (const match of raw.matchAll(/\b(\d+(?:\.\d+)?)(ms|s)\b/g)) {
    const ms = Number(match[1]) * (match[2] === 's' ? 1000 : 1);
    if (ms > maxMs) findings.push(report(line, `${match[0]} is slower than the ${maxMs}ms motion limit in BRAND.md.`));
    else findings.push(report(line, `Raw duration ${match[0]}. Use a motion token.`, 'warning'));
  }
  return findings;
}

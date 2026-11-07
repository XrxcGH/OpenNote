// Named styles as CSS (text DESIGN.md 2.4; ADR 0082). Each key a notebook or page sets on a style becomes a custom
// property on the document root, such as --style-h1-size-pt, and one generated rule per style reads it. Changing a
// value swaps a variable: nothing re-renders and the editor sees no transaction. Adding or removing a key changes
// the generated rules, which is still a CSS change only. Keys only the app sets give no rule, so the type tokens
// keep drawing an unstyled notebook exactly as before.
import { PEN_COLORS } from '../../../editor/schema/constants';
import type { Border, BorderSide, Indent, LineSpacing, Shade } from '../../../editor/paragraph/attributes';
import { HEADING_STYLES } from './model';
import type { LookKey } from './model';
import type { ResolvedStyle } from './resolve';

const SHEET_ID = 'opennote-named-styles';
/** The root attribute the generated rules key on, so they apply only while this module drives the root. */
export const STYLES_ATTRIBUTE = 'data-named-styles';

/** R-THM-2: the pens of the theme's accent colors. */
const ACCENT_PENS = ['indigo', 'brick', 'fern', 'plum', 'amber', 'walnut'];

/** A color value (SPEC D.7) as CSS, following the theme's light and dark pages where it can. */
export function cssColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if ((PEN_COLORS as readonly string[]).includes(value)) return `var(--ink-${value})`;
  if (/^#[0-9a-f]{6}$/.test(value)) return value;
  if (value === 'theme:text') return 'var(--color-text-primary)';
  if (value === 'theme:background') return 'var(--color-surface-page)';
  const accent = /^theme:accent([1-6])$/.exec(value);
  if (accent) return `var(--ink-${ACCENT_PENS[Number(accent[1]) - 1]})`;
  return null;
}

const UNDERLINE_LINE: Readonly<Record<string, string>> = {
  double: 'double',
  wavyDouble: 'wavy',
  wave: 'wavy',
  wavyHeavy: 'wavy',
};

function underlineStyle(value: string): string {
  if (UNDERLINE_LINE[value]) return UNDERLINE_LINE[value];
  if (value.startsWith('dot')) return 'dotted';
  if (value.startsWith('dash')) return 'dashed';
  return 'solid';
}

const pt = (value: unknown) => (typeof value === 'number' ? `${value}pt` : null);
const quoted = (font: unknown) => (typeof font === 'string' ? `"${font.replace(/["\\]/g, '')}"` : null);

function lineHeight(value: unknown): string | null {
  const line = value as LineSpacing | undefined;
  if (!line || typeof line.value !== 'number') return null;
  return line.rule === 'multiple' ? String(line.value) : `${line.value}pt`;
}

function borderSide(side: BorderSide | undefined): string | null {
  if (!side) return null;
  const style =
    side.style === 'double'
      ? 'double'
      : side.style.includes('dot')
        ? 'dotted'
        : side.style.includes('dash')
          ? 'dashed'
          : 'solid';
  return `${side.width}pt ${style} ${cssColor(side.color) ?? 'currentColor'}`;
}

/** The CSS property and value of each key's variable, by key. A key without a CSS form still gets its variable. */
type Declaration = readonly [property: string, value: string | null];

function declarations(key: LookKey, values: ResolvedStyle['values']): Declaration[] {
  const value = values[key];
  switch (key) {
    case 'font':
      return [['font-family', quoted(value)]];
    case 'sizePt':
      return [['font-size', pt(value)]];
    case 'weight':
      return [['font-weight', typeof value === 'number' ? String(value) : null]];
    case 'italic':
      return [['font-style', value ? 'italic' : 'normal']];
    case 'underline':
    case 'strike': {
      const lines = [
        values.underline && values.underline !== 'none' ? 'underline' : '',
        values.strike && values.strike !== 'none' ? 'line-through' : '',
      ];
      const line = lines.filter(Boolean).join(' ') || 'none';
      if (key === 'strike') return [['text-decoration-line', line]];
      const under = typeof value === 'string' && value !== 'none' ? underlineStyle(value) : 'solid';
      return [
        ['text-decoration-line', line],
        ['text-decoration-style', under],
      ];
    }
    case 'caps':
      return [
        ['font-variant-caps', value === 'small' ? 'small-caps' : 'normal'],
        ['text-transform', value === 'all' ? 'uppercase' : 'none'],
      ];
    case 'tracking':
      return [['letter-spacing', pt(value)]];
    case 'textColor':
      return [['color', cssColor(value)]];
    case 'highlight':
      return [['background-color', value === 'none' ? 'transparent' : cssColor(value)]];
    case 'align':
      return [['text-align', value === 'distribute' ? 'justify' : typeof value === 'string' ? value : null]];
    case 'indent': {
      const indent = value as Indent | undefined;
      return [
        ['margin-inline-start', pt(indent?.start)],
        ['margin-inline-end', pt(indent?.end)],
        ['text-indent', pt(indent?.first)],
      ];
    }
    case 'before':
      return [['margin-block-start', pt(value)]];
    case 'after':
      return [['margin-block-end', pt(value)]];
    case 'line':
      return [['line-height', lineHeight(value)]];
    case 'keepNext':
      return [['break-after', value ? 'avoid' : 'auto']];
    case 'keepLines':
      return [['break-inside', value ? 'avoid' : 'auto']];
    case 'widows':
      return [['widows', value === false ? '1' : '2']];
    case 'shade':
      return [['background-color', cssColor((value as Shade | undefined)?.fill) ?? 'transparent']];
    case 'border': {
      const border = value as Border | undefined;
      return [
        ['border-block-start', borderSide(border?.top)],
        ['border-block-end', borderSide(border?.bottom)],
        ['border-inline-start', borderSide(border?.start)],
        ['border-inline-end', borderSide(border?.end)],
      ];
    }
    case 'dir':
      return [['direction', value === 'rtl' ? 'rtl' : 'ltr']];
    // Tab stops, the outline level, contextual spacing, and the language have no CSS form. The editor's plugins
    // read the style's values, and the variable carries them for anything that wants them.
    default:
      return [['', value === undefined ? null : JSON.stringify(value)]];
  }
}

const kebab = (name: string) => name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

/** The custom property of a style's key, with a suffix when one key sets more than one property. */
export function namedStyleVar(style: string, key: string, index = 0): string {
  return `--style-${style}-${kebab(key)}${index === 0 ? '' : `-${index + 1}`}`;
}

/** The elements a style draws: its own name on any element, and the built-in elements that have no other style. */
export function styleSelector(name: string, type: ResolvedStyle['type']): string {
  const safe = name.replace(/[^a-z0-9-]/g, '');
  if (type === 'character') return `span[data-style='${safe}']`;
  const own = `[data-pstyle='${safe}']`;
  if (name === 'normal') return `${own}, p:not([data-pstyle])`;
  if (HEADING_STYLES.slice(0, 6).includes(name)) return `${own}, ${name}:not([data-page-title], [data-pstyle])`;
  if (name === 'title') return `${own}, [data-page-title]`;
  if (name === 'quote') return `${own}, blockquote > p:not([data-pstyle])`;
  if (name === 'code') return `${own}, pre`;
  return own;
}

/** The variables and the rules for the resolved styles: only keys that the notebook or page sets. */
export function namedStylesCss(styles: Iterable<ResolvedStyle>): { vars: Map<string, string>; rules: string } {
  const vars = new Map<string, string>();
  const rules: string[] = [];
  for (const style of styles) {
    const body: string[] = [];
    for (const key of style.own) {
      declarations(key, style.values).forEach(([property, value], index) => {
        if (value === null) return;
        const name = namedStyleVar(style.name, key, index);
        vars.set(name, value);
        if (property) body.push(`${property}: var(${name});`);
      });
    }
    if (body.length === 0) continue;
    const scope = `:is([${STYLES_ATTRIBUTE}] [data-scope~='page'], [${STYLES_ATTRIBUTE}][data-scope~='page'])`;
    rules.push(`${scope} :is(${styleSelector(style.name, style.type)}) { ${body.join(' ')} }`);
  }
  return { vars, rules: rules.length ? `@layer components {\n${rules.join('\n')}\n}` : '' };
}

let shownVars = new Set<string>();

/**
 * Puts the styles on `root`. It sets their variables and removes variables that no style sets any more. It replaces
 * the generated rules only when their text changed, so a changed value moves no rule.
 */
export function applyNamedStyles(root: HTMLElement, styles: Iterable<ResolvedStyle>): void {
  const { vars, rules } = namedStylesCss(styles);
  for (const name of shownVars) if (!vars.has(name)) root.style.removeProperty(name);
  for (const [name, value] of vars)
    if (root.style.getPropertyValue(name) !== value) root.style.setProperty(name, value);
  shownVars = new Set(vars.keys());
  if (rules) root.setAttribute(STYLES_ATTRIBUTE, '');
  else root.removeAttribute(STYLES_ATTRIBUTE);
  const doc = root.ownerDocument;
  let sheet = doc.getElementById(SHEET_ID);
  if (!rules) {
    sheet?.remove();
    return;
  }
  if (!sheet) {
    sheet = doc.createElement('style');
    sheet.id = SHEET_ID;
    doc.head.append(sheet);
  }
  if (sheet.textContent !== rules) sheet.textContent = rules;
}

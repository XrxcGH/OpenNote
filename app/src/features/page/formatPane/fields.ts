// The fields of the Format pane (text DESIGN.md 5.3): the Text, Advanced, and Paragraph tabs. Each field reads the
// selection, parses what was typed with its unit and range, and applies it through the editor commands, so the pane
// never writes a value the commands would refuse. Parsing is separate from applying: a bad value changes nothing and
// gives a message. A field may also say how it reads and writes a style, for style mode (Modify style).
import type { EditorState } from '@tiptap/pm/state';
import type { Command } from '../../../editor/commands/command';
import { setAlign, setPara, setParaEach } from '../../../editor/commands/paragraph';
import {
  editRunTokens,
  runMarkPressed,
  setRunMark,
  setRunValue,
  setWeight,
  weightAt,
} from '../../../editor/commands/runFormat';
import { sizeText } from '../../../editor/commands/sizes';
import type { Align, ParaFormat, ParaKey } from '../../../editor/paragraph/attributes';
import {
  OTF_FEATURES,
  SCALE_PERCENT,
  SHIFT_POINTS,
  TEXT_EFFECTS,
  TRACKING_POINTS,
  UNDERLINE_STYLES,
  isColor,
  isNumberText,
} from '../../../editor/schema/constants';
import { t } from '../../../strings/t';
import { getPageHyphenate } from '../../../editor/paragraph/defaultTab';
import { parseSize, validFontName } from '../../fonts';
import { firstMark, paraValue, runTokens, runValue } from './read';
import type { Shown } from './read';
import { formatPoints, parseLength } from './units';

export type TabId = 'text' | 'advanced' | 'paragraph' | 'tabs' | 'borders' | 'lists';
export const TABS: readonly TabId[] = ['text', 'advanced', 'paragraph', 'tabs', 'borders', 'lists'];

export type Parsed = { ok: true; value: unknown } | { ok: false; message: string };
export type StyleValues = Readonly<Record<string, unknown>>;

export interface Field {
  readonly id: string;
  readonly tab: TabId;
  readonly kind: 'text' | 'choice' | 'toggle' | 'color';
  /** The values of a choice, in order. '' is "none" or "default". */
  readonly options?: readonly string[];
  /** The unit a bare number is in, shown beside the box. */
  readonly unit?: 'pt' | '%';
  read(state: EditorState): Shown;
  /** The state is given to fields whose rules depend on another field, such as the line spacing rule. */
  parse(input: string | boolean, state?: EditorState): Parsed;
  apply(value: unknown): Command;
  /** How style mode reads and writes this field. A field without it is not shown there. */
  readonly style?: {
    read(values: StyleValues): Shown;
    patch(value: unknown, values: StyleValues): Readonly<Record<string, unknown>>;
  };
}

const ok = (value: unknown): Parsed => ({ ok: true, value });
const fail = (message: string): Parsed => ({ ok: false, message });
const range = (min: number, max: number) => t('textPane.range', { min: String(min), max: String(max) });
const invalid = (example: string) => t('textPane.invalid', { example });

/** A length with a unit: blank clears, else points inside [min, max] on a grid. */
export function lengthParse(min: number, max: number, step = 0.05) {
  return (input: string | boolean): Parsed => {
    const text = String(input).trim();
    if (text === '') return ok(null);
    const points = parseLength(text);
    if (points === null) return fail(invalid('12, 0.5in, 1.25cm'));
    const snapped = Math.round(points / step) * step;
    if (snapped < min || snapped > max) return fail(range(min, max));
    return ok(Math.round(snapped * 100) / 100);
  };
}

const choiceParse = (options: readonly string[]) => (input: string | boolean) =>
  options.includes(String(input)) ? ok(String(input)) : fail(invalid(options.join(', ')));

const toggleParse = (input: string | boolean) => ok(input === true || input === 'true');

const shownNumber = (value: unknown): Shown => (typeof value === 'number' ? formatPoints(value) : '');

const colorParse = (input: string | boolean): Parsed => {
  const text = String(input).trim();
  if (text === '') return ok(null);
  return isColor(text) ? ok(text) : fail(t('textPane.badColor'));
};

// ---- Text tab ----

/** A field that sets one single-attribute mark. `parse` turns the typed value into the attribute text or null. */
function span(
  id: string,
  tab: TabId,
  kind: Field['kind'],
  mark: string,
  key: string,
  parse: Field['parse'],
  extra: Partial<Field> = {},
): Field {
  return {
    id,
    tab,
    kind,
    read: (state) => runValue(state, mark, key),
    parse,
    apply: (value) => setRunValue(mark, value === null ? null : String(value)),
    ...extra,
  };
}

/** A mark that is on or off. */
function flag(id: string, mark: string, extra: Partial<Field> = {}): Field {
  return {
    id,
    tab: 'text',
    kind: 'toggle',
    read: (state) => runMarkPressed(state, mark),
    parse: toggleParse,
    apply: (on) => setRunMark(mark, on ? {} : null),
    ...extra,
  };
}

const UNDERLINES = ['', 'single', ...UNDERLINE_STYLES.filter((style) => style !== 'single')];
const WEIGHTS = ['100', '200', '300', '400', '500', '600', '700', '800', '900'];
const CAPS = ['', 'small', 'all'];

/** An effect toggled in the `effect` mark's list, with emboss and engrave excluding each other. */
function effect(token: (typeof TEXT_EFFECTS)[number]): Field {
  const opposite = token === 'emboss' ? 'engrave' : token === 'engrave' ? 'emboss' : '';
  return {
    id: token,
    tab: 'text',
    kind: 'toggle',
    read: (state) => {
      const runs = runTokens(state, 'effect').map((tokens) => tokens.includes(token));
      return runs.every(Boolean) ? true : runs.some(Boolean) ? 'mixed' : false;
    },
    parse: toggleParse,
    apply: (on) =>
      editRunTokens('effect', (tokens) => {
        const rest = tokens.filter((have) => have !== token && !(on && have === opposite));
        return on ? [...rest, token] : rest;
      }),
  };
}

/** One group of OpenType tokens (ligatures, number forms): the group's token replaces the group's others. */
function otf(id: string, group: readonly string[]): Field {
  const options = ['', ...group];
  return {
    id,
    tab: 'advanced',
    kind: 'choice',
    options,
    read: (state) => {
      const runs = new Set(
        runTokens(state, 'otf').map((tokens) => tokens.find((token) => group.includes(token)) ?? ''),
      );
      return runs.size > 1 ? 'mixed' : ([...runs][0] ?? '');
    },
    parse: choiceParse(options),
    apply: (value) =>
      editRunTokens('otf', (tokens) => [
        ...tokens.filter((token) => !group.includes(token)),
        ...(value ? [String(value)] : []),
      ]),
  };
}

/** A number mark (scale, tracking, shift): `not` holds the value that means "no mark". */
function numberMark(
  id: string,
  limits: { min: number; max: number; step: number; not?: readonly number[] },
  parse: Field['parse'],
  unit: Field['unit'],
  extra: Partial<Field> = {},
): Field {
  return span(id, 'advanced', 'text', id, id, parse, {
    unit,
    apply: (value) => {
      const off = value === null || (limits.not ?? []).includes(Number(value));
      return setRunValue(id, off ? null : String(value));
    },
    ...extra,
  });
}

/** Kerning is off (0) or starts at 1 point, as the page format says (R-MRK-10). */
const kernParse = (input: string | boolean): Parsed => {
  const result = lengthParse(0, 1638, 0.5)(input);
  if (result.ok && typeof result.value === 'number' && result.value > 0 && result.value < 1) {
    return fail(t('textPane.kernRange'));
  }
  return result;
};

const underlineAttrs = (state: EditorState) => firstMark(state, 'underline')?.attrs ?? {};

const sizeParse = (input: string | boolean): Parsed => {
  const text = String(input).trim();
  if (text === '') return ok(null);
  const size = parseSize(text);
  if (size.ok) return ok(sizeText(size.points));
  return fail(t(size.reason === 'range' ? 'textFonts.sizeRange' : 'textFonts.sizeInvalid'));
};

const fontParse = (input: string | boolean): Parsed => {
  const text = String(input).trim();
  if (text === '') return ok(null);
  return validFontName(text) ? ok(text) : fail(t('textFonts.invalidName'));
};

const TEXT_FIELDS: readonly Field[] = [
  span('font', 'text', 'text', 'font', 'font', fontParse, {
    style: { read: (v) => String(v.font ?? ''), patch: (value) => ({ font: value ?? undefined }) },
  }),
  {
    id: 'weight',
    tab: 'text',
    kind: 'choice',
    options: WEIGHTS,
    read: (state) => String(weightAt(state)),
    parse: choiceParse(WEIGHTS),
    apply: (value) => setWeight(Number(value)),
    style: { read: (v) => String(v.weight ?? 400), patch: (value) => ({ weight: Number(value) }) },
  },
  span('size', 'text', 'text', 'textSize', 'size', sizeParse, {
    unit: 'pt',
    style: {
      read: (v) => shownNumber(v.sizePt),
      patch: (value) => ({ sizePt: value === null ? undefined : Number(value) }),
    },
  }),
  flag('italic', 'italic', {
    style: { read: (v) => v.italic === true, patch: (value) => ({ italic: value === true ? true : undefined }) },
  }),
  span('color', 'text', 'color', 'textColor', 'color', colorParse, {
    style: { read: (v) => String(v.textColor ?? ''), patch: (value) => ({ textColor: value ?? undefined }) },
  }),
  {
    id: 'underline',
    tab: 'text',
    kind: 'choice',
    options: UNDERLINES,
    read: (state) => {
      const found = runValue(state, 'underline', 'line');
      return found === '1' ? 'single' : found;
    },
    parse: choiceParse(UNDERLINES),
    apply: (value) => (state, dispatch) => {
      if (value === '') return setRunMark('underline', null)(state, dispatch);
      const { color } = underlineAttrs(state);
      const attrs = { ...(value === 'single' ? {} : { line: value }), ...(color ? { color } : {}) };
      return setRunMark('underline', attrs)(state, dispatch);
    },
  },
  {
    id: 'underlineColor',
    tab: 'text',
    kind: 'color',
    read: (state) => runValue(state, 'underline', 'color'),
    // A color needs a line to color: setting it on text with no underline would turn the underline on.
    parse: (input, state) => {
      const parsed = colorParse(input);
      if (parsed.ok && parsed.value !== null && state && !firstMark(state, 'underline')) {
        return fail(t('textPane.underlineFirst'));
      }
      return parsed;
    },
    apply: (value) => (state, dispatch) => {
      if (!firstMark(state, 'underline')) return false;
      const { line } = underlineAttrs(state);
      const attrs = { ...(line ? { line } : {}), ...(value ? { color: value } : {}) };
      return setRunMark('underline', attrs)(state, dispatch);
    },
  },
  {
    id: 'strike',
    tab: 'text',
    kind: 'choice',
    options: ['', 'single', 'double'],
    read: (state) => {
      const found = runValue(state, 'strike', 'line');
      return found === '1' ? 'single' : found;
    },
    parse: choiceParse(['', 'single', 'double']),
    apply: (value) => setRunMark('strike', value === '' ? null : value === 'double' ? { line: 'double' } : {}),
    style: {
      read: (v) => (v.strike === 'single' || v.strike === 'double' ? v.strike : ''),
      patch: (value) => ({ strike: value === '' ? undefined : value }),
    },
  },
  flag('superscript', 'superscript'),
  flag('subscript', 'subscript'),
  span('caps', 'text', 'choice', 'caps', 'caps', (input) => choiceParse(CAPS)(input), {
    options: CAPS,
    apply: (value) => setRunValue('caps', value === '' ? null : String(value)),
    style: {
      read: (v) => (v.caps === 'small' || v.caps === 'all' ? v.caps : ''),
      patch: (value) => ({ caps: value === '' ? undefined : value }),
    },
  }),
  ...TEXT_EFFECTS.map(effect),
  span('highlight', 'text', 'color', 'highlight', 'color', colorParse, {
    // Honey is the highlighter's own color and has no name in the mark: the mark with no color.
    apply: (value) =>
      setRunMark('highlight', value === null ? null : value === 'honey' ? {} : { color: String(value) }),
    style: { read: (v) => String(v.highlight ?? ''), patch: (value) => ({ highlight: value ?? undefined }) },
  }),
];

// ---- Advanced tab ----

const scaleParse = (input: string | boolean): Parsed => {
  const text = String(input).trim().replace(/%$/, '');
  if (text === '') return ok(null);
  if (!/^\d+$/.test(text)) return fail(invalid('90, 150'));
  const inRange = isNumberText(text, { ...SCALE_PERCENT, not: [] });
  return inRange ? ok(Number(text)) : fail(range(SCALE_PERCENT.min, SCALE_PERCENT.max));
};

const ADVANCED_FIELDS: readonly Field[] = [
  numberMark('scale', SCALE_PERCENT, scaleParse, '%'),
  numberMark('tracking', TRACKING_POINTS, lengthParse(TRACKING_POINTS.min, TRACKING_POINTS.max), 'pt', {
    style: {
      read: (v) => shownNumber(v.tracking === 0 ? undefined : v.tracking),
      patch: (value) => ({ tracking: value === null ? undefined : value }),
    },
  }),
  numberMark('shift', SHIFT_POINTS, lengthParse(SHIFT_POINTS.min, SHIFT_POINTS.max, 0.5), 'pt'),
  span('kern', 'advanced', 'text', 'kern', 'kern', kernParse, { unit: 'pt' }),
  otf('ligatures', ['liga-none', 'clig-none', 'dlig', 'hlig']),
  otf('numberForms', ['lnum', 'onum']),
  otf('numberSpacing', ['pnum', 'tnum']),
  otf(
    'stylisticSet',
    OTF_FEATURES.filter((token) => /^ss\d\d$/.test(token)),
  ),
  otf('zero', ['zero']),
];

// ---- Paragraph tab ----

const para = (state: EditorState, pick: (format: ParaFormat) => string | undefined) => paraValue(state, pick);

interface IndentJson {
  start: number;
  end: number;
  first: number;
}

/** An indent object, or null when all three sides are 0. */
const indentJson = (indent: IndentJson) =>
  indent.start === 0 && indent.end === 0 && indent.first === 0 ? null : indent;

const styleIndent = (values: StyleValues): IndentJson => ({
  start: 0,
  end: 0,
  first: 0,
  ...(values.indent as Partial<IndentJson> | undefined),
});

/** One paragraph's indent with one side changed; the other sides stay as that paragraph has them. */
const withIndent = (format: ParaFormat, change: (own: IndentJson) => Partial<IndentJson>) => {
  const own: IndentJson = { start: 0, end: 0, first: 0, ...format.indent };
  return indentJson({ ...own, ...change(own) });
};

/** A paragraph key that is a length, or `auto` for the spacing keys. */
function paraLength(id: 'before' | 'after'): Field {
  return {
    id,
    tab: 'paragraph',
    kind: 'text',
    unit: 'pt',
    read: (state) => para(state, (f) => (f[id] === undefined ? undefined : String(f[id]))),
    parse: (input) => (String(input).trim().toLowerCase() === 'auto' ? ok('auto') : lengthParse(0, 1584)(input)),
    apply: (value) => setPara(id, value),
    style: {
      read: (v) => (typeof v[id] === 'number' ? formatPoints(v[id]) : v[id] === 'auto' ? 'auto' : ''),
      patch: (value) => ({ [id]: value ?? undefined }),
    },
  };
}

/** One side of the indent. Typing nothing means 0. */
function indentSide(id: string, side: 'start' | 'end'): Field {
  return {
    id,
    tab: 'paragraph',
    kind: 'text',
    unit: 'pt',
    read: (state) => para(state, (f) => formatPoints(f.indent?.[side] ?? 0)),
    parse: (input) => lengthParse(-1584, 1584)(String(input).trim() === '' ? '0' : input),
    apply: (value) => setParaEach('indent', (format) => withIndent(format, () => ({ [side]: Number(value) }))),
    style: {
      read: (v) => formatPoints(styleIndent(v)[side]),
      patch: (value, v) => ({ indent: indentJson({ ...styleIndent(v), [side]: Number(value) }) }),
    },
  };
}

const SPECIAL = ['', 'first', 'hanging'];
const LINE_RULES = ['multiple', 'atLeast', 'exact'];
const ALIGNS = ['start', 'center', 'end', 'justify', 'distribute'];
const OUTLINES = ['', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const BOOLEAN_KEYS = ['contextual', 'keepNext', 'keepLines', 'breakBefore', 'widows', 'hyphenate'] as const;
const STYLE_BOOLEANS: ReadonlySet<string> = new Set(['contextual', 'keepNext', 'keepLines', 'widows']);
/** What a boolean key means when a paragraph has none: widow control is on; hyphenation follows the page. */
const booleanDefault = (key: (typeof BOOLEAN_KEYS)[number]): boolean =>
  key === 'widows' ? true : key === 'hyphenate' ? getPageHyphenate() : false;

/** The line spacing value parsed with the rule the selection has: a multiple, or a length in points. */
function lineValueParse(input: string | boolean, state?: EditorState): Parsed {
  const text = String(input).trim();
  if (text === '') return ok(null);
  const rule = state ? para(state, (f) => f.line?.rule ?? 'multiple') : 'multiple';
  if (rule !== 'multiple' && rule !== 'mixed') return lengthParse(0.7, 1584)(text);
  if (!/^\d+([.,]\d+)?$/.test(text)) return fail(invalid('1, 1.15, 1.5'));
  const value = Number(text.replace(',', '.'));
  return value >= 0.06 && value <= 132 ? ok(Math.round(value * 100) / 100) : fail(range(0.06, 132));
}

const PARAGRAPH_FIELDS: readonly Field[] = [
  {
    id: 'align',
    tab: 'paragraph',
    kind: 'choice',
    options: ALIGNS,
    read: (state) => para(state, (f) => f.align ?? 'start'),
    parse: choiceParse(ALIGNS),
    apply: (value) => setAlign(value as Align),
    style: {
      read: (v) => String(v.align ?? 'start'),
      patch: (value) => ({ align: value === 'start' ? undefined : value }),
    },
  },
  {
    id: 'outlineLevel',
    tab: 'paragraph',
    kind: 'choice',
    options: OUTLINES,
    read: (state) => para(state, (f) => (f.outline === undefined ? undefined : String(f.outline))),
    parse: choiceParse(OUTLINES),
    apply: (value) => setPara('outline', value === '' ? null : Number(value)),
    style: {
      read: (v) => String(v.outline ?? ''),
      patch: (value) => ({ outline: value === '' ? undefined : Number(value) }),
    },
  },
  indentSide('indentStart', 'start'),
  indentSide('indentEnd', 'end'),
  {
    id: 'special',
    tab: 'paragraph',
    kind: 'choice',
    options: SPECIAL,
    read: (state) =>
      para(state, (f) => {
        const first = f.indent?.first ?? 0;
        return first > 0 ? 'first' : first < 0 ? 'hanging' : '';
      }),
    parse: choiceParse(SPECIAL),
    apply: (kind) =>
      setParaEach('indent', (format) =>
        withIndent(format, (own) => {
          const size = Math.abs(own.first) || 36;
          return { first: kind === 'first' ? size : kind === 'hanging' ? -size : 0 };
        }),
      ),
  },
  {
    id: 'specialBy',
    tab: 'paragraph',
    kind: 'text',
    unit: 'pt',
    read: (state) => para(state, (f) => formatPoints(Math.abs(f.indent?.first ?? 0))),
    parse: lengthParse(0, 1584),
    apply: (value) =>
      setParaEach('indent', (format) =>
        withIndent(format, (own) => ({ first: own.first < 0 ? -Number(value ?? 0) : Number(value ?? 0) })),
      ),
  },
  paraLength('before'),
  paraLength('after'),
  {
    id: 'lineRule',
    tab: 'paragraph',
    kind: 'choice',
    options: LINE_RULES,
    read: (state) => para(state, (f) => f.line?.rule ?? 'multiple'),
    parse: choiceParse(LINE_RULES),
    apply: (rule) => (state, dispatch) => {
      const before = para(state, (f) => f.line?.rule ?? 'multiple');
      const had = Number(para(state, (f) => (f.line ? String(f.line.value) : undefined))) || 0;
      // A multiple and a length in points do not convert: a change between them starts from 1 or 12 points.
      const same = (before === 'multiple') === (rule === 'multiple');
      const value = rule === 'multiple' ? (same && had > 0 ? had : 1) : same ? Math.max(had, 0.7) : 12;
      return setPara('line', rule === 'multiple' && value === 1 ? null : { rule, value })(state, dispatch);
    },
  },
  {
    id: 'lineValue',
    tab: 'paragraph',
    kind: 'text',
    read: (state) => para(state, (f) => String(f.line?.value ?? 1)),
    parse: lineValueParse,
    apply: (value) => (state, dispatch) => {
      const rule = para(state, (f) => f.line?.rule ?? 'multiple');
      const next = value === null ? null : { rule: rule === 'mixed' ? 'multiple' : rule, value };
      return setPara('line', next && next.rule === 'multiple' && next.value === 1 ? null : next)(state, dispatch);
    },
  },
  ...BOOLEAN_KEYS.map((key): Field => ({
    id: key,
    tab: 'paragraph',
    kind: 'toggle',
    read: (state) => {
      const value = para(state, (f) => String(f[key] ?? booleanDefault(key)));
      return value === 'mixed' ? 'mixed' : value === 'true';
    },
    parse: toggleParse,
    // The default is no key; the other choice is written out, so Off works where the default is On.
    apply: (on) => (state, dispatch) => setPara(key, on === booleanDefault(key) ? null : on)(state, dispatch),
    ...(STYLE_BOOLEANS.has(key)
      ? {
          style: {
            read: (v: StyleValues) => (typeof v[key] === 'boolean' ? v[key] === true : booleanDefault(key)),
            patch: (value: unknown) => ({
              [key]: (value === true) === booleanDefault(key) ? undefined : value === true,
            }),
          },
        }
      : {}),
  })),
  {
    id: 'dir',
    tab: 'paragraph',
    kind: 'choice',
    options: ['', 'ltr', 'rtl'],
    read: (state) => para(state, (f) => f.dir),
    parse: choiceParse(['', 'ltr', 'rtl']),
    apply: (value) => setPara('dir', value === '' ? null : value),
    style: { read: (v) => String(v.dir ?? ''), patch: (value) => ({ dir: value === '' ? undefined : value }) },
  },
];

export const FIELDS: readonly Field[] = [...TEXT_FIELDS, ...ADVANCED_FIELDS, ...PARAGRAPH_FIELDS];

export const fieldsOf = (tab: TabId): Field[] => FIELDS.filter((field) => field.tab === tab);
export const fieldById = (id: string): Field | undefined => FIELDS.find((field) => field.id === id);

/** The paragraph keys the Paragraph tab sets, for tests. */
export const PARA_FIELD_KEYS: readonly ParaKey[] = ['align', 'indent', 'before', 'after', 'line', 'outline', 'dir'];

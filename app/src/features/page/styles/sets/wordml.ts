// checks-disable-file brand-consistency: Word's own default font name is data, not this app's look
// Reads the known-answer fixtures of the style sets: a small part of WordprocessingML (ECMA-376 Part 1, 17.7), the
// document defaults and paragraph styles with basedOn, and the theme's major and minor fonts. It resolves each style
// the way Word does (17.7.2: defaults, then the chain from the root down) and gives the values in this app's units.
// It is written apart from the sets, so the set test compares two independent readings of the same defaults.

/** The values a fixture states for a style, after its chain, in points and this app's names. */
export interface FixtureLook {
  font: string;
  sizePt: number;
  weight: number;
  italic: boolean;
  textColor: string;
  before: number;
  after: number;
  line: number;
  align: string;
  tracking: number;
  indent?: { start: number; end: number };
}

/** Word's style IDs of the built-in styles, by this app's names. */
export const WORD_STYLE_IDS: Readonly<Record<string, string>> = {
  normal: 'Normal',
  title: 'Title',
  subtitle: 'Subtitle',
  quote: 'Quote',
  quote2: 'IntenseQuote',
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => [`h${n}`, `Heading${n}`])),
};

const attr = (tag: string, name: string): string | undefined =>
  new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1] ?? undefined;

/** The first opening (or empty) tag `name` in `xml`, or undefined. */
const tagOf = (xml: string, name: string): string | undefined => new RegExp(`<${name}(\\s[^>]*)?/?>`).exec(xml)?.[0];

/** A toggle property (17.7.3): present without a value, or with true, 1, or on. */
function toggle(xml: string, name: string): boolean | undefined {
  const tag = tagOf(xml, name);
  if (!tag) return undefined;
  const value = attr(tag, 'w:val');
  return value === undefined || value === 'true' || value === '1' || value === 'on';
}

const twips = (value: string | undefined) => (value === undefined ? undefined : Number(value) / 20);

/** The properties one rPr and pPr pair sets, as partial look values. */
function props(xml: string, fonts: { major?: string; minor?: string }): Partial<FixtureLook> {
  const out: Partial<FixtureLook> = {};
  const rFonts = tagOf(xml, 'w:rFonts');
  if (rFonts) {
    const theme = attr(rFonts, 'w:asciiTheme');
    const font = theme ? (theme.startsWith('major') ? fonts.major : fonts.minor) : attr(rFonts, 'w:ascii');
    if (font) out.font = font;
  }
  const size = tagOf(xml, 'w:sz');
  if (size) out.sizePt = Number(attr(size, 'w:val')) / 2;
  const bold = toggle(xml, 'w:b');
  if (bold !== undefined) out.weight = bold ? 700 : 400;
  const italic = toggle(xml, 'w:i');
  if (italic !== undefined) out.italic = italic;
  const color = tagOf(xml, 'w:color');
  if (color) {
    const value = attr(color, 'w:val') ?? 'auto';
    out.textColor = value === 'auto' ? 'theme:text' : `#${value.toLowerCase()}`;
  }
  // Letter spacing lives in rPr's w:spacing (twentieths of a point); paragraph spacing in pPr's.
  const rPr = /<w:rPr>([\s\S]*?)<\/w:rPr>/.exec(xml)?.[1] ?? '';
  const tracking = tagOf(rPr, 'w:spacing');
  if (tracking) out.tracking = Number(attr(tracking, 'w:val')) / 20;
  const pPr = /<w:pPr>([\s\S]*?)<\/w:pPr>/.exec(xml)?.[1] ?? '';
  const spacing = tagOf(pPr, 'w:spacing');
  if (spacing) {
    const before = twips(attr(spacing, 'w:before'));
    const after = twips(attr(spacing, 'w:after'));
    const line = attr(spacing, 'w:line');
    if (before !== undefined) out.before = before;
    if (after !== undefined) out.after = after;
    // An auto line rule is a multiple of 240ths of a line (17.3.1.33), on the 0.01 grid of SPEC R-PARA-1.
    if (line !== undefined && (attr(spacing, 'w:lineRule') ?? 'auto') === 'auto') {
      out.line = Math.round((Number(line) / 240) * 100) / 100;
    }
  }
  const jc = tagOf(pPr, 'w:jc');
  if (jc) {
    const value = attr(jc, 'w:val');
    out.align =
      value === 'center'
        ? 'center'
        : value === 'right' || value === 'end'
          ? 'end'
          : value === 'both'
            ? 'justify'
            : 'start';
  }
  const ind = tagOf(pPr, 'w:ind');
  if (ind) out.indent = { start: twips(attr(ind, 'w:left')) ?? 0, end: twips(attr(ind, 'w:right')) ?? 0 };
  return out;
}

/** Word's values where neither the defaults nor a style says (17.7.2 and 17.3). */
const WORD_DEFAULTS: FixtureLook = {
  font: 'Times New Roman',
  sizePt: 10,
  weight: 400,
  italic: false,
  textColor: 'theme:text',
  before: 0,
  after: 0,
  line: 1,
  align: 'start',
  tracking: 0,
};

/** Every built-in style a fixture defines, resolved, by this app's name. */
export function readFixture(xml: string): Map<string, FixtureLook> {
  const fonts = {
    major: /<a:majorFont>\s*<a:latin typeface="([^"]+)"/.exec(xml)?.[1],
    minor: /<a:minorFont>\s*<a:latin typeface="([^"]+)"/.exec(xml)?.[1],
  };
  const defaults = /<w:docDefaults>([\s\S]*?)<\/w:docDefaults>/.exec(xml)?.[1] ?? '';
  const base: FixtureLook = { ...WORD_DEFAULTS, ...props(defaults, fonts) };
  const styles = new Map<string, { basedOn?: string; body: string }>();
  for (const match of xml.matchAll(/<w:style\s[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const basedOn = tagOf(match[2], 'w:basedOn');
    styles.set(match[1], { basedOn: basedOn ? attr(basedOn, 'w:val') : undefined, body: match[2] });
  }
  const resolve = (id: string): FixtureLook => {
    const chain: string[] = [];
    for (let at: string | undefined = id; at && styles.has(at) && !chain.includes(at); at = styles.get(at)?.basedOn) {
      chain.unshift(at);
    }
    return chain.reduce<FixtureLook>((look, step) => ({ ...look, ...props(styles.get(step)?.body ?? '', fonts) }), {
      ...base,
    });
  };
  const out = new Map<string, FixtureLook>();
  for (const [name, id] of Object.entries(WORD_STYLE_IDS)) if (styles.has(id)) out.set(name, resolve(id));
  return out;
}

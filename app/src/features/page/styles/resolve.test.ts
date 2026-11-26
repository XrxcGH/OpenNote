// checks-disable-file brand-consistency: these tests feed in the colors people choose
// Style resolution (text DESIGN.md 2.4, SPEC R-STY-4 to R-STY-7, R-THM-2). Expected values are worked by hand from
// the spec's layer order.
import { describe, expect, it } from 'vitest';
import { namedStylesCss } from './cssVars';
import { patchStyle, readStyle, userStyleName } from './model';
import { differingFromInherited, nextStyle, resolveAll, resolveStyle, styleChain } from './resolve';
import type { StyleContext } from './resolve';
import { APP_STYLES, styleSet, withStyleSet } from './sets';

const ctx = (notebook: StyleContext['notebook'], extra: Partial<StyleContext> = {}): StyleContext => ({
  app: APP_STYLES,
  notebook,
  ...extra,
});

describe('inheritance', () => {
  it('resolves h2 based on normal at 16 pt, keeping the app heading font over the notebook normal font', () => {
    const look = resolveStyle(ctx({ normal: { font: 'Georgia' }, h2: { basedOn: 'normal', sizePt: 16 } }), 'h2');
    // The app's h2 sets +heading, which sits above the notebook's normal (DESIGN.md 2.4, ECMA-376 17.7.2).
    expect(look.values.font).toBe('OpenNote Sans');
    expect(look.values.sizePt).toBe(16);
    expect(look.chain).toEqual(['normal', 'h2']);
  });

  it('gives a user style based on normal the notebook normal font', () => {
    const look = resolveStyle(ctx({ normal: { font: 'Georgia' }, 'u-memo': { sizePt: 16 } }), 'u-memo');
    expect(look.values.font).toBe('Georgia');
    expect(look.own.has('font')).toBe(true);
  });

  it('keeps the app sizes of headings, title, and code when the notebook sets only normal (SPEC 4.1)', () => {
    const c = ctx({ normal: { sizePt: 14, textColor: '#112233' } });
    expect(resolveStyle(c, 'normal').values.sizePt).toBe(14);
    const h1 = resolveStyle(c, 'h1');
    expect(h1.values.sizePt).toBe(22.5);
    expect(h1.own.has('sizePt')).toBe(false);
    // The app's h1 sets no color, so the notebook's normal color reaches it, as Normal's does in Word.
    expect(h1.values.textColor).toBe('#112233');
    expect(resolveStyle(c, 'title').values.sizePt).toBe(27);
    expect(resolveStyle(c, 'code').values.sizePt).toBe(10);
  });

  it('keeps code in the app mono font after choosing the Word set, which has no code style', () => {
    const word = styleSet('word2016');
    if (!word) throw new Error('missing set');
    const c = ctx(withStyleSet({}, word));
    expect(resolveStyle(c, 'normal').values.font).toBe('Calibri');
    expect(resolveStyle(c, 'code').values.font).toBe('Atkinson Hyperlegible Mono');
    expect(resolveStyle(c, 'code').values.sizePt).toBe(10);
  });

  it('reads a version 1 notebook normal size without changing the heading sizes', () => {
    const c = ctx({ normal: { size: 24 } });
    expect(resolveStyle(c, 'normal').values.sizePt).toBe(18);
    expect(resolveStyle(c, 'h1').values.sizePt).toBe(22.5);
    expect(resolveStyle(c, 'h3').values.sizePt).toBe(15);
  });

  it('cuts a cycle a to b to a at the first repeat, without hanging', () => {
    const sheet = { 'u-a': { basedOn: 'u-b', sizePt: 10 }, 'u-b': { basedOn: 'u-a', font: 'Arial' } };
    expect(styleChain(ctx(sheet), 'u-a')).toEqual(['u-b', 'u-a']);
    const look = resolveStyle(ctx(sheet), 'u-a');
    expect(look.values.font).toBe('Arial');
    expect(look.values.sizePt).toBe(10);
  });

  it('stops after 16 steps and at a name that is not defined', () => {
    const sheet: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 30; i++) sheet[`u-s${i}`] = { basedOn: `u-s${i + 1}` };
    expect(styleChain(ctx(sheet), 'u-s0')).toHaveLength(17);
    expect(styleChain(ctx({ 'u-x': { basedOn: 'u-missing' } }), 'u-x')).toEqual(['u-x']);
  });

  it('ignores a basedOn of the other type (R-STY-4)', () => {
    const sheet = { 'u-c': { type: 'character', basedOn: 'normal', italic: true } };
    expect(styleChain(ctx(sheet), 'u-c')).toEqual(['u-c']);
  });

  it('gives a character style only the run keys its chain sets', () => {
    const sheet = {
      'u-strong': { type: 'character', weight: 700 },
      'u-alert': { type: 'character', basedOn: 'u-strong', textColor: '#aa0000', align: 'center' },
    };
    const look = resolveStyle(ctx(sheet), 'u-alert');
    expect(look.values).toEqual({ weight: 700, textColor: '#aa0000' });
  });

  it('lets the page sheet override the notebook key by key (R-STY-7)', () => {
    const look = resolveStyle(
      ctx({ h1: { sizePt: 20, textColor: '#112233' } }, { page: { h1: { sizePt: 30 } } }),
      'h1',
    );
    expect(look.values.sizePt).toBe(30);
    expect(look.values.textColor).toBe('#112233');
    expect(look.own.has('sizePt')).toBe(true);
  });

  it('marks app values as not own, so the page CSS leaves them to the tokens', () => {
    const look = resolveStyle(ctx({}), 'h1');
    expect(look.own.size).toBe(0);
    expect(look.values.sizePt).toBe(22.5);
  });
});

describe('theme fonts', () => {
  it('resolves tokens through the page theme, then the notebook theme, then the app (R-THM-2)', () => {
    const sheet = { normal: { font: '+body' }, h1: { font: '+heading' }, code: { font: '+mono' } };
    const themed = ctx(sheet, { theme: [{ heading: 'Page Serif' }, { heading: 'Book Serif', body: 'Book Sans' }] });
    expect(resolveStyle(themed, 'h1').values.font).toBe('Page Serif');
    expect(resolveStyle(themed, 'normal').values.font).toBe('Book Sans');
    expect(resolveStyle(themed, 'code').values.font).toBe('Atkinson Hyperlegible Mono');
  });
});

describe('next style', () => {
  it('is normal after headings and titles, the style itself otherwise, or what the style says', () => {
    expect(nextStyle(ctx({}), 'h3')).toBe('normal');
    expect(nextStyle(ctx({}), 'quote')).toBe('quote');
    expect(nextStyle(ctx({ 'u-step': { next: 'h2' } }), 'u-step')).toBe('h2');
  });
});

describe('update style to match selection', () => {
  it('stores only values that differ from the inherited ones', () => {
    const c = ctx({ normal: { font: 'Georgia', sizePt: 11 }, h2: { sizePt: 16, italic: true } });
    const effective = { font: 'Georgia', sizePt: 16, weight: 700, italic: false, textColor: 'theme:text' };
    // Without its own values, h2 takes the app's h2 over the notebook's normal: OpenNote Sans, 18 pt, 700. It isn't
    // italic, and it has the theme's text color. The font and the size differ; h2's own italic is dropped.
    expect(differingFromInherited(c, 'h2', effective)).toEqual({ font: 'Georgia', sizePt: 16 });
  });
});

describe('reading and writing', () => {
  it('reads version 1 keys when the version 2 key is missing, and lets version 2 win (R-STY-2)', () => {
    expect(readStyle({ size: 24, spaceBefore: 16, lineHeight: 1.5, color: 'indigo' })).toMatchObject({
      sizePt: 18,
      before: 12,
      line: { rule: 'multiple', value: 1.5 },
      textColor: 'indigo',
    });
    expect(readStyle({ size: 24, sizePt: 11, color: 'theme:accent1' })).toEqual({ sizePt: 11 });
  });

  it('keeps unknown keys and drops the version 1 twin of a written key', () => {
    expect(patchStyle({ size: 24, future: 1 }, { sizePt: 20 })).toEqual({ future: 1, sizePt: 20 });
  });

  it('names user styles u- and a slug, unique in the notebook', () => {
    expect(userStyleName('Lab Notes!', [])).toBe('u-lab-notes');
    expect(userStyleName('Lab notes', ['u-lab-notes'])).toBe('u-lab-notes-2');
    expect(userStyleName('***', [])).toBe('u-style');
  });
});

describe('names a reader draws', () => {
  it('skips names that are not style names (R-STY-3) but keeps them in the sheet', () => {
    const page = { "x) } body { display:none } [data-y='": { sizePt: 9 }, 'U-Foo': { sizePt: 9 }, 'u-ok': {} };
    const names = [...resolveAll(ctx({}, { page })).keys()];
    expect(names).toContain('u-ok');
    expect(names).not.toContain('U-Foo');
    expect(names.some((name) => name.includes('display'))).toBe(false);
  });

  it('puts no declaration of a hostile name into the generated rules', () => {
    const hostile = "x) } body { display:none } [data-y='";
    const c = ctx({}, { page: { [hostile]: { sizePt: 9 } } });
    expect(namedStylesCss(resolveAll(c).values()).rules).not.toContain('display');
    // Even a style resolved by hand draws nothing under a name that is not a style name.
    expect(namedStylesCss([resolveStyle(c, hostile)]).rules).not.toContain('display');
  });

  it('draws at most 64 styles of a page sheet (R-STY-5)', () => {
    const page: Record<string, Record<string, unknown>> = {};
    for (let i = 0; i < 1000; i++) page[`u-s${i}`] = { sizePt: 10 };
    const drawn = [...resolveAll(ctx({}, { page })).keys()].filter((name) => name.startsWith('u-'));
    expect(drawn).toHaveLength(64);
    expect(drawn[0]).toBe('u-s0');
    expect(drawn).not.toContain('u-s64');
  });
});

import { afterEach, describe, expect, expectTypeOf, it } from 'vitest';
import { en } from './en';
import { PSEUDO_END, PSEUDO_START } from './pseudo';
import { formatMessage, setPseudoLocale, t } from './t';
import type { MessageAt, MessageKey, Params, ParamsArg } from './t';

// A stand-in for t() over any message text, so the type tests don't depend on today's strings.
declare function message<M extends string>(text: M, ...values: ParamsArg<M>): string;

afterEach(() => setPseudoLocale(false));

describe('t() types', () => {
  it('lists every key as a dotted path', () => {
    expectTypeOf<'theme.darkMode'>().toExtend<MessageKey>();
    expectTypeOf<MessageAt<'theme.darkMode'>>().toEqualTypeOf<'Dark mode'>();
    expectTypeOf<'theme.nope'>().not.toExtend<MessageKey>();
  });

  it('infers parameters from placeholders', () => {
    expectTypeOf<ParamsArg<'No pages yet.'>>().toEqualTypeOf<[]>();
    expectTypeOf<Params<'Moved "{title}" to Trash.'>>().toEqualTypeOf<{ title: string | number }>();
    expectTypeOf<Params<'{a} and {b}'>>().toEqualTypeOf<{ a: string | number; b: string | number }>();
  });

  it('types plural counts as numbers and select values as strings', () => {
    type Moved = '{count, plural, one {Moved # page to {target}.} other {Moved # pages to {target}.}}';
    expectTypeOf<Params<Moved>>().toEqualTypeOf<{ count: number; target: string | number }>();
    expectTypeOf<Params<'{kind, select, page {A page} other {Something}}'>>().toEqualTypeOf<{ kind: string }>();
    expectTypeOf<Params<'{kind, select, page {Page {n}} other {Item}}'>>().toEqualTypeOf<{
      kind: string;
      n: string | number;
    }>();
  });

  it('rejects missing, extra, and misspelled parameters', () => {
    const typeOnly = () => {
      message('No pages yet.');
      message('Hi {name}.', { name: 'Ada' });
      // @ts-expect-error: the parameter is missing
      message('Hi {name}.');
      // @ts-expect-error: the parameter is misspelled
      message('Hi {name}.', { nme: 'Ada' });
      // @ts-expect-error: the message takes no parameters
      message('No pages yet.', { name: 'Ada' });
      // @ts-expect-error: plural counts must be numbers
      message('{count, plural, one {# page} other {# pages}}', { count: 'three' });
      // @ts-expect-error: not a key
      t('theme.missing');
    };
    expect(typeOnly).toBeTypeOf('function');
  });
});

describe('formatting', () => {
  it('substitutes placeholders', () => {
    expect(formatMessage('Moved "{title}" to Trash.', { title: 'Mitosis' })).toBe('Moved "Mitosis" to Trash.');
    expect(formatMessage('{count} results', { count: 1200 })).toBe('1,200 results');
  });

  it('picks plural branches, with exact matches first', () => {
    const text = '{count, plural, =0 {No pages} one {# page in {where}} other {# pages in {where}}}';
    expect(formatMessage(text, { count: 0, where: 'Labs' })).toBe('No pages');
    expect(formatMessage(text, { count: 1, where: 'Labs' })).toBe('1 page in Labs');
    expect(formatMessage(text, { count: 1000, where: 'Labs' })).toBe('1,000 pages in Labs');
  });

  it('picks select branches, falling back to other', () => {
    const text = '{kind, select, page {Page} section {Section} other {Item}}';
    expect(formatMessage(text, { kind: 'section' })).toBe('Section');
    expect(formatMessage(text, { kind: 'notebook' })).toBe('Item');
  });

  it('formats a message by key', () => {
    expect(t('theme.darkMode')).toBe('Dark mode');
  });

  it('marks and lengthens every string in the pseudo-locale', () => {
    setPseudoLocale(true);
    const text = t('theme.darkMode');
    expect(text.startsWith(PSEUDO_START) && text.endsWith(PSEUDO_END)).toBe(true);
    expect(text.length).toBeGreaterThanOrEqual(Math.ceil('Dark mode'.length * 1.4));
  });
});

describe('the English strings', () => {
  const messages: [string, string][] = [];
  const walk = (node: object, prefix: string) =>
    Object.entries(node).forEach(([key, value]) =>
      typeof value === 'string' ? messages.push([`${prefix}${key}`, value]) : walk(value, `${prefix}${key}.`),
    );
  walk(en, '');

  it('format with sample values', () => {
    for (const [key, text] of messages) {
      const names = [...text.matchAll(/\{(\w+)/g)].map((match) => match[1]);
      const values = Object.fromEntries(names.map((name) => [name, 1]));
      expect(formatMessage(text, values), key).not.toMatch(/\{|\}/);
    }
  });

  it('give every plural an other branch', () => {
    for (const [key, text] of messages) {
      const plurals = text.match(/\{\w+, plural,/g) ?? [];
      const others = text.match(/\bother \{/g) ?? [];
      expect(others.length, key).toBeGreaterThanOrEqual(plurals.length);
    }
  });
});

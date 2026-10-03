import { getAttributesFromExtensions, resolveExtensions } from '@tiptap/core';
import { describe, expect, it } from 'vitest';
import { serializeTextBlock } from '../markdown/serialize';
import { MARK_ORDER, linkKind, isBlockedHref } from './specs';
import { tableExtensions, textExtensions, textSchema } from './schema';

describe('attribute parse rules', () => {
  // Without its own parseHTML, Tiptap reads an attribute from the pasted element's attribute of the same name and
  // lets it override what the parse rule set, so a pasted `<h1 level="...">` chose the heading's tag name.
  it.each([
    ['text', textExtensions],
    ['table', tableExtensions],
  ])('reads every %s attribute through its own parseHTML', (_name, extensions) => {
    const unparsed = getAttributesFromExtensions(resolveExtensions(extensions))
      .filter(({ attribute }) => typeof attribute.parseHTML !== 'function')
      .map(({ type, name }) => `${type}.${name}`);
    expect(unparsed).toEqual([]);
  });

  it('writes a heading tag from a clamped level', () => {
    const heading = textSchema.nodes.heading;
    const tagOf = (level: unknown) => (heading.spec.toDOM?.(heading.create({ level })) as readonly unknown[])[0];
    expect(tagOf('ttp://www.w3.org/1999/xhtml script')).toBe('h1');
    expect(tagOf(9)).toBe('h6');
  });

  it('never writes a color or size that breaks out of its Markdown tag', () => {
    const { marks } = textSchema;
    const doc = textSchema.nodes.doc.create(null, [
      textSchema.nodes.paragraph.create(null, [
        textSchema.text('a', [marks.textColor.create({ color: '"><script>x</script>' })]),
        textSchema.text('b', [marks.textSize.create({ size: '"><b>' })]),
        textSchema.text('c', [marks.highlight.create({ color: '"><i>' })]),
      ]),
    ]);
    expect(serializeTextBlock(doc)).not.toMatch(/"></);
  });
});

describe('text schema', () => {
  it('has the marks in SPEC 7.7 nesting order', () => {
    expect(Object.keys(textSchema.marks)).toEqual([...MARK_ORDER]);
  });

  it('starts a block with a paragraph', () => {
    expect(textSchema.nodes.doc.createAndFill()?.firstChild?.type.name).toBe('paragraph');
  });

  it('keeps a list item as a paragraph followed by blocks', () => {
    const item = textSchema.nodes.listItem;
    expect(item.createAndFill(null, textSchema.nodes.horizontalRule.create())?.firstChild?.type.name).toBe('paragraph');
  });

  it('gives a callout a title before its body', () => {
    const callout = textSchema.nodes.callout.createAndFill({ type: 'tip' });
    expect(callout?.firstChild?.type.name).toBe('calloutTitle');
  });

  it('never lets subscript and superscript share a range', () => {
    const sub = textSchema.marks.subscript.create();
    const sup = textSchema.marks.superscript.create();
    expect(sup.addToSet([sub]).map((mark) => mark.type.name)).toEqual(['superscript']);
  });
});

describe('link destinations', () => {
  it('sorts schemes into live and inert kinds', () => {
    expect(linkKind('https://example.com')).toBe('web');
    expect(linkKind('mailto:a@example.com')).toBe('mail');
    expect(linkKind('opennote:page/01m3sabc')).toBe('opennote');
    expect(linkKind('asset:01m3sabc')).toBe('asset');
    expect(linkKind('ftp://example.com')).toBe('inert');
    expect(linkKind('notes.md')).toBe('inert');
  });

  it('blocks script-like schemes', () => {
    expect(isBlockedHref(' JavaScript:alert(1)')).toBe(true);
    expect(isBlockedHref('data:text/html,x')).toBe(true);
    expect(isBlockedHref('https://example.com')).toBe(false);
  });

  it('reads the scheme as a browser does, after it drops tabs, line ends, and leading controls', () => {
    expect(isBlockedHref('java\tscript:alert(1)')).toBe(true);
    expect(isBlockedHref('java\r\nscript:alert(1)')).toBe(true);
    expect(isBlockedHref('\x01\x1f javascript:alert(1)')).toBe(true);
    expect(isBlockedHref('https://example.com/a\x00b')).toBe(true);
    expect(linkKind('\thttps://example.com')).toBe('web');
  });
});

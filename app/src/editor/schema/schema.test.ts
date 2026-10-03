import { describe, expect, it } from 'vitest';
import { MARK_ORDER, linkKind, isBlockedHref } from './specs';
import { textSchema } from './schema';

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
});

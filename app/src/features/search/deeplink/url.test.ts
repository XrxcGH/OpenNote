import { describe, expect, it } from 'vitest';
import { formatLink, formatNodeLink, linkInArgs, nodeLinkInArgs, parseLink, parseNodeLink } from './url';

describe('opennote links', () => {
  it('round-trips a page link and a paragraph link', () => {
    expect(parseLink(formatLink('01hzx3k9q7m2v5c8d4e6f0abcd'))).toEqual({
      page: '01hzx3k9q7m2v5c8d4e6f0abcd',
      target: null,
    });
    const link = formatLink('01hzx3k9q7m2v5c8d4e6f0abcd', '01hzx3k9q7m2v5c8d4e6f0wxyz');
    expect(link).toBe('opennote://page/01hzx3k9q7m2v5c8d4e6f0abcd/01hzx3k9q7m2v5c8d4e6f0wxyz');
    expect(parseLink(link)).toEqual({ page: '01hzx3k9q7m2v5c8d4e6f0abcd', target: '01hzx3k9q7m2v5c8d4e6f0wxyz' });
  });

  it('refuses anything else', () => {
    expect(parseLink('https://example.com/page/abcdefgh')).toBeNull();
    expect(parseLink('opennote://settings/abcdefgh')).toBeNull();
    expect(parseLink('opennote://page/..%2F..%2Fetc')).toBeNull();
    expect(parseLink('opennote://page/abc')).toBeNull();
    expect(parseLink('opennote://page/abcdefgh/ijklmnop/extra')).toBeNull();
  });

  it('finds a link among launch arguments', () => {
    expect(linkInArgs(['--flag', 'opennote://page/abcdefgh'])).toEqual({ page: 'abcdefgh', target: null });
    expect(linkInArgs(['notes.onepkg'])).toBeNull();
  });
});

describe('section and notebook links', () => {
  it('round-trips and refuses anything else', () => {
    const id = '01hzx3k9q7m2v5c8d4e6f0abcd';
    expect(formatNodeLink('section', id)).toBe(`opennote://section/${id}`);
    expect(parseNodeLink(formatNodeLink('section', id))).toEqual({ kind: 'section', id });
    expect(parseNodeLink(formatNodeLink('notebook', id))).toEqual({ kind: 'notebook', id });
    expect(parseNodeLink(`opennote://page/${id}`)).toBeNull();
    expect(parseNodeLink('opennote://section/..%2F..%2Fetc')).toBeNull();
    expect(parseNodeLink('opennote://notebook/abc')).toBeNull();
    expect(parseLink(`opennote://section/${id}`)).toBeNull();
    expect(nodeLinkInArgs(['--x', `opennote://notebook/${id}`])).toEqual({ kind: 'notebook', id });
    expect(nodeLinkInArgs([`opennote://page/${id}`])).toBeNull();
  });
});

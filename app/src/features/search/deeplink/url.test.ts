import { describe, expect, it } from 'vitest';
import { formatLink, linkInArgs, parseLink } from './url';

describe('opennote links', () => {
  it('round-trips a page link and a paragraph link', () => {
    expect(parseLink(formatLink('01hzx3k9q7m2v5c8d4e6f0abcd'))).toEqual({ page: '01hzx3k9q7m2v5c8d4e6f0abcd', target: null });
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

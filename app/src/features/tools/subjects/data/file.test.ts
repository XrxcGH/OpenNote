import { describe, expect, it } from 'vitest';
import { looksBinary } from './file';

describe('looksBinary', () => {
  it('takes text, tabs, line breaks, and other scripts as text', () => {
    expect(looksBinary('')).toBe(false);
    expect(looksBinary('x,y\r\n1,2\r\n3,4\r\n')).toBe(false);
    expect(looksBinary('a\tb\n1\t2')).toBe(false);
    expect(looksBinary('名前,値\n試験,3')).toBe(false);
  });

  it('takes a NUL, control characters, or a run of replacement characters as binary', () => {
    expect(looksBinary('PK\u0003\u0004\u0000\u0000')).toBe(true);
    expect(looksBinary('\u0001\u0002\u0003\u0004 abc')).toBe(true);
    expect(looksBinary('\ufffd\ufffd\ufffd\ufffd data \ufffd\ufffd')).toBe(true);
  });

  it('looks only at the start of a long file', () => {
    expect(looksBinary('1,2\n'.repeat(5000) + '\u0000'.repeat(50))).toBe(false);
  });
});

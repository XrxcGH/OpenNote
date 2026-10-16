import { describe, expect, it } from 'vitest';
import { splitCapture } from './capture';

describe('quick capture text', () => {
  it('takes the first line as the title and the rest as the body', () => {
    expect(splitCapture('Buy milk\nand eggs\n\nsoon')).toEqual({ title: 'Buy milk', body: 'and eggs\n\nsoon' });
    expect(splitCapture('  Just a title  ')).toEqual({ title: 'Just a title', body: '' });
    expect(splitCapture('One\r\nTwo')).toEqual({ title: 'One', body: 'Two' });
  });

  it('has nothing to save when the first line is empty', () => {
    expect(splitCapture('')).toBeNull();
    expect(splitCapture('   \n  ')).toBeNull();
  });

  it('keeps a title within the 200 character limit', () => {
    expect(splitCapture('a'.repeat(500))?.title).toHaveLength(200);
  });
});

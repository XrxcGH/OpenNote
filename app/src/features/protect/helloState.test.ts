import { describe, expect, it } from 'vitest';
import { noteHello, usesHello } from './helloState';

describe('the Windows Hello state of sections', () => {
  it('does not use Hello until the shell says so, then follows each change', () => {
    expect(usesHello('s1')).toBe(false);
    noteHello('s1', true);
    expect(usesHello('s1')).toBe(true);
    noteHello('s1', false);
    expect(usesHello('s1')).toBe(false);
  });
});

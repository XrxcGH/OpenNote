import { expect, it } from 'vitest';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

// Pinned from a property-test seed: a tab before backticks inside a quote must not close the fence.
it('keeps a tab-indented backtick line inside a quoted code block', () => {
  const once = serializeTextBlock(parseTextBlock('>     \t```'));
  expect(serializeTextBlock(parseTextBlock(once))).toBe(once);
});

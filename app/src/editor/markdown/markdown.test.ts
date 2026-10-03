import { describe, expect, it } from 'vitest';
import { DOCUMENTS, ESCAPES } from './fixtures';
import { escapeParagraphText } from './escape';
import { parseTextBlock } from './parse';
import { serializeTextBlock } from './serialize';

describe('canonical fixtures', () => {
  it.each(DOCUMENTS.map((fixture) => [fixture.name, fixture.markdown] as const))('%s', (_name, markdown) => {
    expect(serializeTextBlock(parseTextBlock(markdown))).toBe(markdown);
  });
});

describe('escaping', () => {
  it.each(ESCAPES)('writes %j as %j', (text, written) => {
    expect(escapeParagraphText(text)).toBe(written);
  });
});

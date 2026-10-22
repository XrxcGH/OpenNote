import { describe, expect, it } from 'vitest';
import type { OpenPage } from '../../../services/pages/types';
import { tagEdit, typedTags } from './inlineTags';

const page = (tags: string[]) =>
  ({ initial: { tags }, readOnly: null, onFrame: () => () => undefined }) as unknown as OpenPage;

describe('typed tags', () => {
  it('finds finished tags only, outside code', () => {
    expect(typedTags('Review \\#Todo and #a/b-c, #123 `#code` \\#last')).toEqual(['todo', 'a/b-c']);
    expect(typedTags('Review \\#todo ')).toEqual(['todo']);
    // The editor writes a space that ends the text as `&#32;`; without that space the word is not finished.
    expect(typedTags('Review \\#todo&#32;')).toEqual(['todo']);
    expect(typedTags('Review \\#todo')).toEqual([]);
    expect(typedTags('Plan #exam/unit-3 now')).toEqual(['exam/unit-3']);
  });

  it('adds a tag the page lacks once', () => {
    const open = page(['school']);
    expect(tagEdit(open, 'Review \\#todo', 'Review \\#todo ')).toEqual({ edit: 'setPage', tags: ['school', 'todo'] });
    expect(tagEdit(open, 'Review \\#todo ', 'Review \\#todo x')).toBeNull();
    expect(tagEdit(page(['todo']), '', 'a \\#todo ')).toBeNull();
  });
});

describe('typed hashtag rules', () => {
  it('ends a tag at punctuation as well as a space', () => {
    expect(typedTags('See \\#todo, \\#a.b; (\\#c) and \\#d!')).toEqual(['todo', 'a', 'd']);
    expect(typedTags('Trailing \\#dash- and \\#path/ x')).toEqual(['dash', 'path']);
  });

  it('leaves numbers, C#, headings, code, and web addresses alone', () => {
    expect(typedTags('\\#1 and \\#2024 ')).toEqual([]);
    expect(typedTags('I write C# and F# code ')).toEqual([]);
    expect(typedTags('# Heading\n\n## Two ')).toEqual([]);
    expect(typedTags('`\\#inline ` and\n```\n#fenced \n```\n')).toEqual([]);
    expect(typedTags('Go to https://example.com/#top now and [x](https://a.b/ #frag) ')).toEqual([]);
    expect(typedTags('<https://example.com/page> \\#real ')).toEqual(['real']);
  });

  it('reads a tag after a newline', () => {
    expect(typedTags('first\n\\#second ')).toEqual(['second']);
  });
});

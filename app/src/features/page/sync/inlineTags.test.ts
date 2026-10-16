import { describe, expect, it } from 'vitest';
import type { OpenPage } from '../../../services/pages/types';
import { tagEdit, typedTags } from './inlineTags';

const page = (tags: string[]) =>
  ({ initial: { tags }, readOnly: null, onFrame: () => () => undefined }) as unknown as OpenPage;

describe('typed tags', () => {
  it('finds finished tags only, outside code', () => {
    expect(typedTags('Review \\#Todo and #a/b-c, #123 `#code` \\#last')).toEqual(['todo']);
    expect(typedTags('Review \\#todo ')).toEqual(['todo']);
    expect(typedTags('Plan #exam/unit-3 now')).toEqual(['exam/unit-3']);
  });

  it('adds a tag the page lacks once', () => {
    const open = page(['school']);
    expect(tagEdit(open, 'Review \\#todo', 'Review \\#todo ')).toEqual({ edit: 'setPage', tags: ['school', 'todo'] });
    expect(tagEdit(open, 'Review \\#todo ', 'Review \\#todo x')).toBeNull();
    expect(tagEdit(page(['todo']), '', 'a \\#todo ')).toBeNull();
  });
});

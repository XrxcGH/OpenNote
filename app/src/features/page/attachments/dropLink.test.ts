// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { droppedLink, linkMarkdown } from './dropLink';

describe('dropped links', () => {
  it('takes a dragged address and uses the link text a browser sent', () => {
    expect(droppedLink('https://example.com/a', '<a href="https://example.com/a">Cell biology</a>')).toEqual({
      href: 'https://example.com/a',
      title: 'Cell biology',
    });
    expect(droppedLink('https://example.com/a', null)).toEqual({
      href: 'https://example.com/a',
      title: 'https://example.com/a',
    });
  });

  it('falls back to the link when the text is only the address, and ignores other drops', () => {
    expect(droppedLink(null, '<a href="https://example.com/x">Title</a>')?.href).toBe('https://example.com/x');
    expect(droppedLink('Some words https://example.com', null)).toBeNull();
    expect(droppedLink('ftp://example.com', null)).toBeNull();
    expect(droppedLink('https://example.com', '<p>Paragraph <a href="https://example.com">link</a></p>')?.title).toBe(
      'https://example.com',
    );
  });

  it('writes Markdown that survives brackets and spaces', () => {
    expect(linkMarkdown({ href: 'https://example.com/a', title: 'Notes [draft]' })).toBe(
      '[Notes \\[draft\\]](https://example.com/a)',
    );
    expect(linkMarkdown({ href: 'https://example.com/a b', title: 'x' })).toBe('[x](<https://example.com/a b>)');
  });
});

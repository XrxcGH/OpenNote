// @vitest-environment jsdom
import { DOMParser as PMDOMParser } from '@tiptap/pm/model';
import { describe, expect, it } from 'vitest';
import { textSchema } from '../../../editor/schema/schema';
import { parseHtml } from './dom';
import { plainCopy } from './plainCopy';

function copied(html: string): string {
  return plainCopy(PMDOMParser.fromSchema(textSchema).parse(parseHtml(html).body));
}

describe('plain copy', () => {
  it('drops the Markdown marks and keeps the words', () => {
    expect(copied('<p>A <strong>bold</strong>, <em>slanted</em>, <code>code</code> and <a href="https://x.test/">link</a></p>')).toBe(
      'A bold, slanted, code and link',
    );
  });

  it('separates blocks with a blank line and keeps list markers', () => {
    const text = copied('<h2>Plan</h2><p>Two</p><ul><li>one</li><li>two<ol><li>deep</li></ol></li></ul>');
    expect(text).toBe('Plan\n\nTwo\n\n- one\n- two\n  1. deep');
  });

  it('keeps an equation as its source and a hard break as a new line', () => {
    expect(copied('<p>a<br>b <span data-math="x^2"></span></p>')).toBe('a\nb x^2');
  });
});

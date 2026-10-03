// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { SpellingService } from '../host';
import { rangeOver, SpellingHighlights, textblockText } from './spellingRanges';

function paragraph(html: string): HTMLElement {
  const element = document.createElement('p');
  element.innerHTML = html;
  document.body.append(element);
  return element;
}

const service = (
  results: Record<string, { start: number; length: number }[]>,
): SpellingService & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked,
    errorsFor: (text) => results[text] ?? null,
    requestCheck: (_key, text) => void asked.push(text),
  };
};

describe('textblock text', () => {
  it('masks code, math, images, and addresses, keeping offsets in line', () => {
    const element = paragraph(
      'See <code>teh</code> and <span data-math="x">x</span><img alt=""> at https://teh.example or a@teh.io<br>end',
    );
    const { text } = textblockText(element);
    expect(text).toBe(`See ${' '.repeat(3)} and ${' '.repeat(2)} at ${' '.repeat(19)} or ${' '.repeat(8)} end`);
  });

  it("skips ProseMirror's own separators, so static and mounted text are the same", () => {
    const mounted = paragraph('teh<img class="ProseMirror-separator"><br class="ProseMirror-trailingBreak">');
    expect(textblockText(mounted).text).toBe('teh');
  });

  it('builds ranges across formatting', () => {
    const element = paragraph('a <strong>re</strong><em>cieve</em> b');
    const range = rangeOver(textblockText(element), 2, 7);
    expect(range?.toString()).toBe('recieve');
  });
});

describe('spelling highlights', () => {
  it('shows cached errors and asks for unknown text', () => {
    const highlights = new SpellingHighlights();
    const element = paragraph('I recieve teh');
    const known = service({ 'I recieve teh': [{ start: 2, length: 7 }] });
    expect(highlights.refresh(element, known, true)).toBeNull();
    expect(highlights.ranges(element).map(String)).toEqual(['recieve']);
    const unknown = service({});
    expect(highlights.refresh(paragraph('other'), unknown, true, 'k')).toBe('other');
    expect(unknown.asked).toEqual(['other']);
  });

  it('carries errors before and after an edit until the new text is checked', () => {
    const highlights = new SpellingHighlights();
    const element = paragraph('teh cat recieve');
    highlights.refresh(
      element,
      service({
        'teh cat recieve': [
          { start: 0, length: 3 },
          { start: 8, length: 7 },
        ],
      }),
      false,
    );
    element.firstChild!.textContent = 'teh big cat recieve';
    highlights.refresh(element, service({}), false);
    expect(highlights.entry(element)?.errors).toEqual([
      { start: 0, length: 3 },
      { start: 12, length: 7 },
    ]);
    expect(highlights.ranges(element).map(String)).toEqual(['teh', 'recieve']);
    element.firstChild!.textContent = 'tehx big cat recieve';
    highlights.refresh(element, service({}), false);
    expect(highlights.ranges(element).map(String)).toEqual(['recieve']);
  });

  it('keeps the ranges that typing moved with the text, so the page is not repainted', () => {
    const highlights = new SpellingHighlights();
    const element = paragraph('a teh cat');
    highlights.refresh(element, service({ 'a teh cat': [{ start: 2, length: 3 }] }), false);
    const [before] = highlights.ranges(element);
    (element.firstChild as Text).insertData(0, 'big ');
    highlights.refresh(element, service({}), false);
    expect(highlights.ranges(element)).toEqual([before]);
    expect(highlights.ranges(element)[0]).toBe(before);
    expect(String(before)).toBe('teh');
  });

  it('leaves the word at the caret alone until the caret leaves it', () => {
    const highlights = new SpellingHighlights();
    const element = paragraph('a teh');
    const known = service({ 'a teh': [{ start: 2, length: 3 }] });
    highlights.setGuard(element, 5);
    highlights.refresh(element, known, false);
    expect(highlights.ranges(element)).toHaveLength(0);
    highlights.setGuard(null);
    highlights.refresh(element, known, false);
    expect(highlights.ranges(element).map(String)).toEqual(['teh']);
  });

  it('lists elements in document order and forgets removed ones', () => {
    const highlights = new SpellingHighlights();
    const first = paragraph('one');
    const second = paragraph('two');
    const none = service({ one: [], two: [] });
    highlights.refresh(second, none, false);
    highlights.refresh(first, none, false);
    expect(highlights.shownIn(document.body)).toEqual([first, second]);
    second.remove();
    highlights.resolve(none);
    expect(highlights.entry(second)).toBeNull();
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { domFitInputs } from './fitInputs';

describe('domFitInputs', () => {
  it('reads the shown text of each column and measures it in the cell font', () => {
    document.body.innerHTML =
      '<table><tr><th style="font: 20px serif">Name</th><th>Total</th></tr>' +
      '<tr><td><strong>Bold</strong> text</td><td>42</td></tr></table>';
    const fonts: string[] = [];
    const inputs = domFitInputs(document.body, (font) => {
      fonts.push(font);
      return (line) => line.length * 10;
    })!;
    // Rendered text: no ** marks, and the shown number, not a formula.
    expect(inputs.texts(0)).toEqual(['Name', 'Bold text']);
    expect(inputs.texts(1)).toEqual(['Total', '42']);
    expect(inputs.measure('abcd')).toBe(40);
    expect(fonts).toHaveLength(1);
    expect(fonts[0]).toContain('20px');
  });

  it('is null without a table', () => {
    document.body.innerHTML = '<p>none</p>';
    expect(domFitInputs(document.body)).toBeNull();
  });
});

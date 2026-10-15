// The visual equation editor, in a real browser: MathLive reads and writes the page's LaTeX without changing what
// the equation says.
import { describe, expect, it } from 'vitest';
import { ALL_EQUATIONS } from '../../../test/equations';
import { renderLatex } from '../latex/render';
import { roundTrip, visualMath } from './field';

/** The words and symbols KaTeX would draw, which is what a reader sees. */
function seen(latex: string): string {
  const drawn = renderLatex(latex, { displayMode: true });
  if (!drawn.ok) throw new Error(`${latex}: ${drawn.error.message}`);
  const box = document.createElement('div');
  box.innerHTML = drawn.html;
  return (box.querySelector('.katex-html')?.textContent ?? '').replace(/\s+/g, '');
}

describe('the visual equation editor', () => {
  it('keeps what every equation of the library says through a round trip', async () => {
    const changed: string[] = [];
    for (const latex of ALL_EQUATIONS) {
      const back = await roundTrip(latex);
      expect(renderLatex(back, { displayMode: true }).ok, `${latex} became ${back}`).toBe(true);
      if (seen(back) !== seen(latex)) changed.push(`${latex} -> ${back}`);
    }
    expect(changed).toEqual([]);
  }, 60_000);

  it('makes a field that holds LaTeX, reads it back, and speaks it', async () => {
    const field = await visualMath.create({ value: '\frac{1}{2}', label: 'Equation editor', display: false });
    document.body.append(field.element);
    expect(field.element.getAttribute('aria-label')).toBe('Equation editor');
    expect(field.value).toBe('\frac{1}{2}');
    field.value = 'x^2+1';
    expect(field.value).toBe('x^2+1');
    expect(field.spoken().length).toBeGreaterThan(0);
    field.element.remove();
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { ALL_EQUATIONS, BROKEN_EQUATIONS } from '../../../test/equations';
import { copyPayload, toMarkdownMath, toMathML } from './copy';
import { renderLatex } from './render';
import { validateLatex } from './validate';

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, 'application/xml');
}

describe('rendering a library of equations', () => {
  it('has a library of about fifty equations', () => {
    expect(ALL_EQUATIONS.length).toBeGreaterThanOrEqual(50);
  });

  it.each(ALL_EQUATIONS.map((latex) => [latex]))('renders %s without an error', (latex) => {
    for (const displayMode of [false, true]) {
      const result = renderLatex(latex, { displayMode });
      if (!result.ok) throw new Error(`${latex}: ${result.error.message} at ${result.error.position}`);
      expect(result.html).not.toContain('katex-error');
      expect(result.html).toContain('class="katex-html" aria-hidden="true"');
      expect(result.html).toContain('<math');
    }
  });

  it.each(ALL_EQUATIONS.map((latex) => [latex]))(
    'gives %s MathML that is well-formed and keeps the source',
    (latex) => {
      const doc = parseXml(toMathML(latex));
      expect(doc.querySelector('parsererror')).toBeNull();
      expect(doc.documentElement.localName).toBe('math');
      expect(doc.querySelector('annotation')?.textContent).toBe(latex);
    },
  );
});

describe('the markup for screen readers', () => {
  it('puts MathML behind the visible math, and hides the visible part from assistive technology', () => {
    const result = renderLatex('\\frac{a}{b}');
    if (!result.ok) throw new Error('should render');
    const doc = new DOMParser().parseFromString(result.html, 'text/html');
    const visible = doc.querySelector('.katex-html');
    const readable = doc.querySelector('.katex-mathml math');
    expect(visible?.getAttribute('aria-hidden')).toBe('true');
    expect(readable?.querySelector('mfrac')).not.toBeNull();
    expect(readable?.querySelectorAll('mi')).toHaveLength(2);
  });

  it('marks display math as a block', () => {
    const inline = renderLatex('x^2');
    const display = renderLatex('x^2', { displayMode: true });
    if (!inline.ok || !display.ok) throw new Error('should render');
    expect(inline.html).not.toContain('katex-display');
    expect(display.html).toContain('katex-display');
    expect(toMathML('x^2', true)).toContain('display="block"');
  });
});

describe('errors', () => {
  it.each(BROKEN_EQUATIONS.map((broken) => [broken.latex, broken.position] as const))(
    'points at the problem in %s',
    (latex, position) => {
      const validation = validateLatex(latex);
      if (validation.valid) throw new Error(`${latex} should not be valid`);
      expect(validation.error.position).toBe(position);
      expect(validation.error.length).toBeGreaterThan(0);
      expect(validation.error.message).not.toMatch(/KaTeX parse error/);
    },
  );

  it('says which command it does not know', () => {
    const validation = validateLatex('a + \\foo b');
    if (validation.valid) throw new Error('should be invalid');
    expect(validation.error.message).toContain('\\foo');
    expect(validation.error.length).toBe(4);
  });

  it('returns the same problem from render and validate, and never throws', () => {
    const rendered = renderLatex('\\frac{1}{2');
    const validated = validateLatex('\\frac{1}{2');
    expect(rendered.ok).toBe(false);
    if (rendered.ok || validated.valid) throw new Error('should fail');
    expect(rendered.error).toEqual(validated.error);
  });

  it('accepts good LaTeX and an empty equation', () => {
    expect(validateLatex('x^2 + y^2 = r^2')).toEqual({ valid: true });
    expect(validateLatex('')).toEqual({ valid: true });
  });
});

describe('safety', () => {
  it('does not turn links, images, or raw attributes into live markup', () => {
    for (const latex of ['\\href{https://example.com}{x}', '\\url{https://example.com}', '\\includegraphics{a.png}']) {
      const result = renderLatex(latex);
      if (result.ok) expect(result.html).not.toMatch(/<a |<img |href=/);
    }
    const html = renderLatex('\\htmlClass{evil}{x} \\htmlStyle{opacity:0}{y}');
    if (html.ok) expect(html.html).not.toMatch(/class="evil"|style="opacity:0"/);
  });

  it('stops a macro that calls itself', () => {
    const result = validateLatex('\\def\\a{\\a\\a}\\a');
    expect(result.valid).toBe(false);
  });

  it('caps a huge rule', () => {
    const result = renderLatex('\\rule{9999em}{9999em}');
    if (!result.ok) throw new Error('should render');
    expect(result.html).not.toContain('width:9999em');
    expect(result.html).toContain('width:50em');
  });
});

describe('copying', () => {
  it('copies LaTeX as written, trimmed', () => {
    expect(copyPayload('  \\frac{a}{b}\n', 'latex')).toEqual({ text: '\\frac{a}{b}' });
  });

  it('copies MathML as text and as HTML', () => {
    const payload = copyPayload('\\sqrt{2}', 'mathml');
    expect(payload.text.startsWith('<math')).toBe(true);
    expect(payload.text.endsWith('</math>')).toBe(true);
    expect(payload.html).toBe(payload.text);
    expect(payload.text).toContain('<msqrt>');
    expect(payload.text).toContain('xmlns="http://www.w3.org/1998/Math/MathML"');
  });

  it('copies Markdown math in the note format: inline on one line, display on its own lines', () => {
    expect(toMarkdownMath(' x^2 ')).toBe('$x^2$');
    expect(toMarkdownMath('a +\n b')).toBe('$a + b$');
    expect(toMarkdownMath('x^2', true)).toBe('$$\nx^2\n$$');
    expect(copyPayload('x^2', 'markdown', true).text).toBe('$$\nx^2\n$$');
  });

  it('throws when asked for the MathML of LaTeX that does not render', () => {
    expect(() => copyPayload('\\frac{', 'mathml')).toThrow();
  });
});

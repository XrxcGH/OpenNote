// Calculus in an equation: the answer offered after one that ends in "=" (pressed to add it when closed, Tab to add
// it while editing), and the Steps panel with folded working that can be put on the page.
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { afterEach, describe, expect, it } from 'vitest';
import type { EditorHost, MathRenderer, MathStepsView } from '../host';
import { mathBlockExtensions, openMathAt, runMathAction } from './math';

const STEPS: MathStepsView = {
  ok: true,
  title: 'Steps for the derivative',
  steps: [
    {
      name: 'Chain rule',
      rule: 'Chain rule: the derivative of the outside, times the derivative of the inside.',
      latex: '\\frac{d}{dx}\\left[\\sin x^{2}\\right] = 2x\\cos x^{2}',
      note: 'u = x^{2}',
      children: [{ name: 'Power rule', rule: 'Power rule.', latex: '\\frac{d}{dx}\\left[x^{2}\\right] = 2x' }],
    },
  ],
  result: '2x\\cos x^{2}',
  block: '\\begin{aligned} & 2x \\end{aligned}',
};

const renderer: MathRenderer = {
  render: (source) => ({ ok: true, html: `<span class="drawn-test">${source}</span>` }),
  suggest: (latex) => Promise.resolve(/=\s*$/.test(latex) ? { latex: '3x^{2}', text: '3x^2' } : null),
  steps: () => Promise.resolve(STEPS),
};

const said: string[] = [];
const host = {
  math: () => Promise.resolve(renderer),
  announce: (text: string) => said.push(text),
} as unknown as EditorHost;

let editor: Editor | null = null;
afterEach(() => {
  const element = editor?.view.dom.parentElement;
  editor?.destroy();
  element?.remove();
  editor = null;
  said.length = 0;
});

function make(source: string): Editor {
  const element = document.body.appendChild(document.createElement('div'));
  editor = new Editor({ element, extensions: [StarterKit, ...mathBlockExtensions(host)] });
  editor.commands.setContent({ type: 'doc', content: [{ type: 'mathBlock', attrs: { source } }] });
  return editor;
}

const until = async (find: () => Element | null | undefined): Promise<Element> => {
  for (let i = 0; i < 100; i += 1) {
    const found = find();
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('not found');
};

const sources = (ed: Editor) => {
  const out: string[] = [];
  ed.state.doc.descendants((node) => void (node.type.name === 'mathBlock' && out.push(node.attrs.source as string)));
  return out;
};

describe('calculus answers in an equation', () => {
  it('offers the answer after an equation that ends in "=", and adds it when pressed', async () => {
    const ed = make('\\frac{d}{dx}x^{3}=');
    const offered = (await until(() => ed.view.dom.querySelector('[data-math-suggestion]'))) as HTMLButtonElement;
    expect(offered.getAttribute('aria-label')).toContain('3x^2');
    offered.click();
    expect(sources(ed)).toEqual(['\\frac{d}{dx}x^{3}= 3x^{2}']);
    await until(() => (ed.view.dom.querySelector('[data-math-suggestion]') ? null : ed.view.dom));
    expect(said.at(-1)).toContain('3x^2');
  });

  it('shows the answer in gray while editing, and Tab adds it', async () => {
    const ed = make('\\int x^{2}dx');
    await until(() => ed.view.dom.querySelector('.drawn-test'));
    expect(openMathAt(ed, 0)).toBe(true);
    const field = (await until(() => ed.view.dom.querySelector('textarea'))) as HTMLTextAreaElement;
    field.value = '\\frac{d}{dx}x^{3}=';
    field.dispatchEvent(new Event('input'));
    await until(() => ed.view.dom.querySelector('[data-math-ghost]'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(field.value).toBe('\\frac{d}{dx}x^{3}= 3x^{2}');
  });

  it('folds the working inside a step, and puts the steps on the page', async () => {
    const ed = make('\\frac{d}{dx}\\sin(x^{2})');
    await until(() => ed.view.dom.querySelector('.drawn-test'));
    ed.commands.setNodeSelection(0);
    expect(runMathAction(ed, 'steps')).toBe(true);
    const panel = await until(() => ed.view.dom.querySelector('[data-math-steps]'));
    const fold = panel.querySelector('details') as HTMLDetailsElement;
    expect(fold.querySelector('summary')?.textContent).toContain('Chain rule');
    expect(fold.querySelectorAll('li')).toHaveLength(1);
    (panel.querySelector('[data-math-steps-insert]') as HTMLButtonElement).click();
    expect(sources(ed)).toEqual(['\\frac{d}{dx}\\sin(x^{2})', STEPS.ok ? STEPS.block : '']);
  });
});

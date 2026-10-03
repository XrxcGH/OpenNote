// @vitest-environment jsdom
// Drawn equations in a mounted editor: the page's renderer draws them with MathML for screen readers, a mistake
// shows its problem in the source field, and Insert equation puts an empty atom at the caret and opens its field.
import { NodeSelection } from '@tiptap/pm/state';
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor, testHost } from '../../editor/commands/testing';
import type { TestEditor } from '../../editor/commands/testing';
import { insertMath } from './insert';
import { mathRenderer } from './mathHost';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

const host = () => testHost({ math: () => Promise.resolve(mathRenderer) });

async function mount(source: string): Promise<TestEditor> {
  mounted = mountEditor(source, host());
  await new Promise((resolve) => setTimeout(resolve, 0));
  return mounted;
}

describe('drawn math', () => {
  it('draws an inline equation with MathML behind it and keeps its source in the name', async () => {
    const page = await mount(String.raw`Area $\pi r^2$ here`);
    const atom = page.root.querySelector('[data-math]')!;
    expect(atom.getAttribute('role')).toBe('math');
    expect(atom.getAttribute('aria-label')).toBe(String.raw`Math: \pi r^2`);
    expect(atom.querySelector('.katex-mathml math')).not.toBeNull();
    expect(page.markdown()).toBe(String.raw`Area $\pi r^2$ here`);
  });

  it('draws display math on its own line', async () => {
    const page = await mount('$$\nx^2 + y^2\n$$');
    expect(page.root.querySelector('[data-math-block] .katex-display')).not.toBeNull();
  });

  it('keeps showing the source of LaTeX that does not parse, and says why', async () => {
    const page = await mount(String.raw`Bad $\frac{1}{2}$ math`);
    page.editor.view.dispatch(page.editor.state.tr.setNodeMarkup(5, undefined, { source: String.raw`\frac{1` }));
    const atom = page.root.querySelector<HTMLElement>('[data-math]')!;
    expect(atom.textContent).toBe(String.raw`$\frac{1$`);
    expect(atom.title).not.toBe('');
    expect(atom.hasAttribute('role')).toBe(false);
  });

  it('previews while the source field is open and reports a problem as it is typed', async () => {
    const page = await mount('$x$');
    page.root.querySelector('[data-math]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const field = page.root.querySelector<HTMLInputElement>('input[aria-label="Math source"]')!;
    expect(page.root.querySelector('.katex')).not.toBeNull();
    field.value = String.raw`\frac{1`;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(page.root.querySelector('[role="status"]')!.textContent).toMatch(/^LaTeX problem: /);
    field.value = String.raw`\frac{1}{2}`;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(field.getAttribute('aria-invalid')).toBe('false');
    expect(page.root.querySelector('[role="status"]')!.textContent).toBe('');
  });
});

describe('insertMath', () => {
  it('puts an empty inline equation at the caret and opens its field', async () => {
    const page = await mount('Area is ');
    page.editor.commands.focus('end');
    expect(insertMath(page.editor, false)).toBe(true);
    expect(page.root.querySelector('input[aria-label="Math source"]')).not.toBeNull();
    expect(page.editor.state.selection).toBeInstanceOf(NodeSelection);
  });

  it('takes the selected text as the LaTeX of an inline equation', async () => {
    const page = await mount('Area is pi');
    page.editor.commands.setTextSelection({ from: 9, to: 11 });
    insertMath(page.editor, false);
    expect(page.root.querySelector<HTMLInputElement>('input[aria-label="Math source"]')!.value).toBe('pi');
  });

  it('inserts display math as its own block', async () => {
    const page = await mount('Before');
    page.editor.commands.focus('end');
    expect(insertMath(page.editor, true)).toBe(true);
    expect(page.root.querySelector('textarea[aria-label="Math source"]')).not.toBeNull();
    expect(page.editor.state.doc.childCount).toBe(2);
  });
});

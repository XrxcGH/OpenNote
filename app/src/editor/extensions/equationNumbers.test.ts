// @vitest-environment jsdom
// Equation numbers follow the order of the equations, and references follow the numbers.
import { afterEach, describe, expect, it } from 'vitest';
import { mountEditor } from '../commands/testing';
import type { TestEditor } from '../commands/testing';
import { numberingOf } from './equationNumbers';

let mounted: TestEditor | null = null;
afterEach(() => {
  mounted?.destroy();
  mounted = null;
});

const SOURCE = 'See $\\eqref{b}$.\n\n$$\na=1 \\label{a}\n$$\n\n$$\nb=2 \\label{b}\n$$\n';

const numbers = (page: TestEditor): string[] =>
  [...page.root.querySelectorAll('[data-eq-number]')].map((el) => el.getAttribute('data-eq-number') ?? '');
const refs = (page: TestEditor): string[] =>
  [...page.root.querySelectorAll('[data-eq-ref]')].map((el) => el.getAttribute('data-eq-ref') ?? '');

describe('equation numbers', () => {
  it('numbers labeled display equations and resolves references', () => {
    mounted = mountEditor(SOURCE);
    expect(numbers(mounted)).toEqual(['1', '2']);
    expect(refs(mounted)).toEqual(['(2)']);
  });

  it('renumbers and updates the reference when an equation moves', () => {
    mounted = mountEditor(SOURCE);
    const { editor } = mounted;
    const [first] = numberingOf(editor.state.doc).blocks;
    const tr = editor.state.tr.delete(first.pos, first.pos + first.node.nodeSize);
    tr.insert(tr.doc.content.size, first.node);
    editor.view.dispatch(tr);
    expect(refs(mounted)).toEqual(['(1)']);
    expect(numberingOf(editor.state.doc).numbering.byKey.get('a')).toBe(2);
  });

  it('shows an unresolved reference', () => {
    mounted = mountEditor('See $\\eqref{nope}$.\n');
    expect(refs(mounted)).toEqual(['(??)']);
  });

  it('keeps the label when the page is saved as Markdown', () => {
    mounted = mountEditor(SOURCE);
    expect(mounted.markdown()).toContain('\\label{a}');
    expect(mounted.markdown()).toContain('$\\eqref{b}$');
  });
});

// Equation numbers and references reach every export, because the export page is numbered as it is read.
import { describe, expect, it } from 'vitest';
import { exportMarkdown } from './toMarkdown';
import { exportHtml } from './toHtml';
import { readExportPage } from './source';

const page = readExportPage({
  id: 'p1',
  title: 'Statics',
  blocks: [
    { id: 'b2', type: 'text', order: 'b', data: { markdown: '$$\nF = m a \\label{newton}\n$$' } },
    { id: 'b1', type: 'text', order: 'a', data: { markdown: 'Start from $\\eqref{newton}$ and $\\eqref{gone}$.' } },
    { id: 'b3', type: 'text', order: 'c', data: { markdown: '$$\nE = m c^2 \\label{mass}\n$$\n\nSee $\\eqref{mass}$.' } },
  ],
});

describe('numbered equations in exports', () => {
  it('numbers in reading order, not in the order the blocks are stored', () => {
    const markdown = exportMarkdown(page, { frontMatter: 'none' }).markdown;
    expect(markdown).toContain('Start from (1) and (??).');
    expect(markdown).toContain('F = m a \\tag{1}');
    expect(markdown).toContain('E = m c^2 \\tag{2}');
    expect(markdown).toContain('See (2).');
    expect(markdown).not.toContain('\\label');
    expect(markdown).not.toContain('\\eqref');
  });

  it('reaches the HTML export, which draws the tag with the math', () => {
    const html = exportHtml(page, { renderers: undefined } as never).html;
    expect(html).toContain('Start from (1) and (??).');
    expect(html).toContain('\\tag{1}');
  });

  it('leaves a page with no labels untouched', () => {
    const plain = readExportPage({ blocks: [{ id: 'a', type: 'text', order: 'a', data: { markdown: 'Costs $5.' } }] });
    expect(exportMarkdown(plain, { frontMatter: 'none' }).markdown).toContain('Costs $5.');
  });
});

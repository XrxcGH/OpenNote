// checks-disable-file brand-consistency: test colors are inputs, not design colors.
// Rendering of every run and paragraph format in a real browser (text DESIGN.md 7): computed styles, static DOM equal
// to mounted DOM for every inline-v2 and paras fixture, forced colors, and the render cost of a formatted page.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { cdp } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import blockStyles from './blocks.module.css';
import { testHost } from '../../../editor/commands/testing';
import { createBlockEditor } from '../../../editor/extensions/kit';
import { LISTS_META } from '../../../editor/extensions/listItem';
import { applyElementData } from '../../../editor/markdown/elements';
import { parseTextBlock } from '../../../editor/markdown/parse';
import { readLists } from '../../../editor/paragraph/numbering';
import { renderStatic } from '../../../editor/schema/dom';
// Importing registers the block marks in every text editor.
import '../../../editor/render/plugin';

// The format fixtures, read as text by Vite (the browser has no file system).
const FILES = import.meta.glob('../../../../../docs/format/fixtures/markdown/{inline-v2,paras}/*.json', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;
const json = (path: string) => {
  const key = Object.keys(FILES).find((file) => file.endsWith(`/${path}`));
  if (!key) throw new Error(`no fixture ${path}`);
  return JSON.parse(FILES[key]) as Record<string, unknown>;
};

let editor: Editor | null = null;
afterEach(() => {
  editor?.destroy();
  editor = null;
  document.body.replaceChildren();
  document.body.removeAttribute('data-theme-scope');
});

/** A `.text` wrapper with a `.ProseMirror` box inside, as the page has them; the box is what the tests render into. */
function host(): HTMLElement {
  const wrapper = document.body.appendChild(document.createElement('div'));
  wrapper.className = blockStyles.text;
  wrapper.style.cssText = 'width: 600px; font: 16px serif';
  const root = wrapper.appendChild(document.createElement('div'));
  root.className = 'ProseMirror';
  return root;
}

function docOf(markdown: string, entry: Record<string, unknown> = {}): PMNode {
  return applyElementData(parseTextBlock(markdown), { ids: ['a', 'b', 'c', 'd', 'e', 'f'], paras: { a: entry } });
}

/** Static render of a document inside a host in the page; returns the first element matching `selector`. */
function drawn(doc: PMNode, selector: string): HTMLElement {
  const root = host();
  renderStatic(doc, root);
  const found = root.querySelector<HTMLElement>(selector);
  if (!found) throw new Error(`nothing matches ${selector}`);
  return found;
}

const styleOf = (markdown: string, selector: string, entry?: Record<string, unknown>) =>
  getComputedStyle(drawn(docOf(markdown, entry), selector));

describe('computed styles of the named formats (text DESIGN.md 2.2 and 2.3)', () => {
  it('draws 10.5 points as 14px', () => {
    expect(styleOf('<span data-size="10.5">x</span>', 'span').fontSize).toBe('14px');
  });

  it('draws tracking of 1.5 points as 2px of letter spacing', () => {
    expect(styleOf('<span data-tracking="1.5">x</span>', 'span').letterSpacing).toBe('2px');
  });

  it('draws a shift of 3 points as a vertical align of 4px', () => {
    expect(styleOf('<span data-shift="3">x</span>', 'span').verticalAlign).toBe('4px');
  });

  it('draws a first line indent of -18 points as a text indent of -24px', () => {
    expect(styleOf('word', 'p', { indent: { first: -18 } }).textIndent).toBe('-24px');
  });

  it('draws exact line spacing of 18 points as a line height of 24px', () => {
    expect(styleOf('word', 'p', { line: { rule: 'exact', value: 18 } }).lineHeight).toBe('24px');
  });

  it('draws a wavy underline', () => {
    expect(styleOf('<u data-line="wave">x</u>', 'u').textDecorationStyle).toBe('wavy');
  });

  it('draws small caps', () => {
    expect(styleOf('<span data-caps="small">x</span>', 'span').fontVariantCaps).toBe('small-caps');
  });
});

describe('computed styles of spacing, shading, and highlights', () => {
  it('draws a line multiple as the multiple times the font factor', () => {
    const style = styleOf('word', 'p', { line: { rule: 'multiple', value: 2 } });
    expect(Number.parseFloat(style.lineHeight)).toBeCloseTo(2 * 1.2 * 16, 1);
  });

  it('draws a double strike, a box outline, and a font stack with the metric alias', () => {
    expect(styleOf('<del data-line="double">x</del>', 'del').textDecorationStyle).toBe('double');
    expect(styleOf('<span data-box="dashed">x</span>', 'span').outlineStyle).toBe('dashed');
    expect(styleOf('<span data-font="Calibri">x</span>', 'span').fontFamily).toMatch(/^Calibri, Carlito,/);
  });

  it('draws alignment, spacing, shading, and borders', () => {
    const style = styleOf('word', 'p', {
      align: 'distribute',
      before: 6,
      after: 'auto',
      shade: { fill: '#ffcc00' },
      border: { top: { style: 'single', width: 1, space: 2 } },
    });
    expect(style.textAlignLast).toBe('justify');
    expect(style.marginBlockStart).toBe('8px');
    expect(style.marginBlockEnd).toBe('18.667px');
    expect(style.backgroundColor).toBe('rgb(255, 204, 0)');
    expect(style.borderBlockStartStyle).toBe('solid');
    expect(style.paddingBlockStart).toBe('2.667px');
  });

  it('draws a custom highlight at 45 percent opacity in dark mode and opaque in light mode', () => {
    const root = host();
    renderStatic(docOf('<mark data-color="#336699">x</mark>'), root);
    const mark = root.querySelector('mark')!;
    expect(getComputedStyle(mark).backgroundColor).toBe('rgb(51, 102, 153)');
    document.body.setAttribute('data-theme-scope', 'dark');
    expect(getComputedStyle(mark).backgroundColor).toBe('color(srgb 0.2 0.4 0.6 / 0.45)');
  });
});

describe('computed styles of groups, labels, and scaled words', () => {
  it('groups bordered neighbors into one box that draws between only inside the group', () => {
    const border = { top: { style: 'single' }, bottom: { style: 'single' }, between: { style: 'dotted' } };
    const root = host();
    const doc = applyElementData(parseTextBlock('one\n\ntwo\n\nthree'), {
      ids: ['a', 'b', 'c'],
      paras: { a: { border }, b: { border }, c: { border } },
    });
    renderStatic(doc, root);
    const [first, middle, last] = [...root.querySelectorAll('p')];
    expect(first.getAttribute('data-border-place')).toBe('first');
    expect(middle.getAttribute('data-border-place')).toBe('middle');
    expect(last.getAttribute('data-border-place')).toBe('last');
    expect(getComputedStyle(first).borderBlockStartStyle).toBe('solid');
    expect(getComputedStyle(first).borderBlockEndStyle).toBe('dotted');
    expect(getComputedStyle(middle).borderBlockStartStyle).toBe('none');
    expect(getComputedStyle(last).borderBlockEndStyle).toBe('solid');
  });

  it('labels a list item that names a list from the numbering engine', () => {
    const doc = applyElementData(parseTextBlock('1. one\n2. two'), {
      ids: ['a', 'b'],
      paras: { a: { list: { id: 'l1' } }, b: { list: { id: 'l1' } } },
    });
    const root = host();
    renderStatic(doc, root, readLists({ l1: { levels: [{ format: 'upperRoman', text: '%1)' }] } }));
    const items = [...root.querySelectorAll('li')];
    expect(items.map((item) => item.style.getPropertyValue('--list-label'))).toEqual(['"I) "', '"II) "']);
    expect(getComputedStyle(items[1], '::marker').content).toBe('"II) "');
  });

  it('draws each word of a scaled run in its own box, scaled across and kept in line', () => {
    const root = host();
    renderStatic(docOf('<span data-scale="150">two words</span>'), root);
    const words = [...root.querySelectorAll<HTMLElement>('[data-scaled]')];
    expect(words.map((word) => word.textContent)).toEqual(['two', 'words']);
    expect(getComputedStyle(words[0]).transform).toBe('matrix(1.5, 0, 0, 1, 0, 0)');
  });
});

describe('forced colors', () => {
  const emulate = (value: 'active' | 'none') =>
    cdp().send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value }] });
  afterEach(() => emulate('none'));

  it('keeps every run readable and still draws underline styles and borders', async () => {
    await emulate('active');
    const root = host();
    const markdown = [
      '==marked== <span data-color="#ff0000">red</span> <span data-shade="#00ff00">shade</span>',
      '<u data-line="wave" data-line-color="#0000ff">wave</u> <span data-box="double">box</span>',
      '<span data-effect="outline">out</span> <mark data-color="#ffee00">hex</mark> <span data-comment="a">note</span>',
    ].join('\n\n');
    const doc = applyElementData(parseTextBlock(markdown), {
      ids: ['a', 'b', 'c'],
      paras: { b: { border: { top: { style: 'single', width: 1 } }, shade: { fill: '#ffcc00' } } },
    });
    renderStatic(doc, root);
    const runs = [...root.querySelectorAll<HTMLElement>('span, mark, u, p')];
    expect(runs.length).toBeGreaterThan(6);
    for (const run of runs) {
      const style = getComputedStyle(run);
      expect(style.color, run.outerHTML).not.toBe(style.backgroundColor);
    }
    expect(getComputedStyle(root.querySelector('u')!).textDecorationStyle).toBe('wavy');
    expect(getComputedStyle(root.querySelector('[data-box]')!).outlineStyle).toBe('double');
    expect(getComputedStyle(root.querySelectorAll('p')[1]).borderBlockStartStyle).toBe('solid');
  });

  it('keeps a deletion struck through and tells it from an insertion without color', async () => {
    await emulate('active');
    const root = host();
    const insertion = root.appendChild(document.createElement('span'));
    insertion.setAttribute('data-ins', '');
    const deletion = root.appendChild(document.createElement('span'));
    deletion.setAttribute('data-del', '');
    expect(getComputedStyle(insertion).textDecorationLine).toBe('underline');
    expect(getComputedStyle(insertion).textDecorationStyle).toBe('dashed');
    expect(getComputedStyle(deletion).textDecorationLine).toBe('line-through');
    expect(getComputedStyle(deletion).textDecorationStyle).toBe('dashed');
  });
});

describe('shade, group spacing, hanging indents, and drop caps', () => {
  it('draws a run shade behind a highlight, not over it', () => {
    const root = host();
    renderStatic(docOf('<mark data-color="#ffee00"><span data-shade="#00ff00">x</span></mark>'), root);
    expect(getComputedStyle(root.querySelector('mark')!).backgroundColor).toBe('rgb(255, 238, 0)');
    expect(getComputedStyle(root.querySelector('[data-shade]')!).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    const alone = drawn(docOf('<span data-shade="#00ff00">y</span>'), '[data-shade]');
    expect(getComputedStyle(alone).backgroundColor).toBe('rgb(0, 255, 0)');
  });

  it('keeps no space between the members of a border group, whatever their spacing', () => {
    const border = { start: { style: 'single', width: 1, space: 2 } };
    const spaced = { border, before: 12, after: 12 };
    const root = host();
    renderStatic(
      applyElementData(parseTextBlock('one\n\ntwo\n\nthree'), {
        ids: ['a', 'b', 'c'],
        paras: { a: spaced, b: spaced, c: spaced },
      }),
      root,
    );
    const [first, middle, last] = [...root.querySelectorAll('p')].map((p) => getComputedStyle(p));
    expect([first.marginBlockStart, first.marginBlockEnd]).toEqual(['16px', '0px']);
    expect([middle.marginBlockStart, middle.marginBlockEnd]).toEqual(['0px', '0px']);
    expect([last.marginBlockStart, last.marginBlockEnd]).toEqual(['0px', '16px']);
  });

  it('adds a start border space to the padding of a hanging indent', () => {
    const style = styleOf('word', 'p', {
      indent: { start: 27, end: 0, first: -13.5 },
      border: { start: { style: 'single', width: 1, space: 6 } },
    });
    // 13.5 pt of hanging padding is 18px and a 6 pt space is 8px.
    expect(style.paddingInlineStart).toBe('26px');
  });

  it('draws a drop cap as an initial letter, and a margin drop cap outside the text', () => {
    const drop = { dropCap: { mode: 'drop', lines: 3, distance: 6 } };
    const first = getComputedStyle(drawn(docOf('Word', drop), 'p'), '::first-letter');
    expect(first.getPropertyValue('initial-letter')).toMatch(/^3/);
    expect(first.marginInlineEnd).toBe('8px');
    expect(first.marginInlineStart).toBe('0px');
    const margin = getComputedStyle(
      drawn(docOf('Word', { dropCap: { ...drop.dropCap, mode: 'margin' } }), 'p'),
      '::first-letter',
    );
    expect(Number.parseFloat(margin.marginInlineStart)).toBeLessThan(0);
  });
});

// ---- Static render equals mounted render ----

/** A DOM subtree as comparable text: the editor's own bookkeeping removed, styles sorted, measured margins ignored. */
function normalized(root: HTMLElement): string {
  const copy = root.cloneNode(true) as HTMLElement;
  // What only the editor adds: its bookkeeping, fold buttons, and the tab layout's boxes (which hold the tab itself).
  for (const extra of copy.querySelectorAll(
    '.ProseMirror-trailingBreak, .ProseMirror-separator, [class*="foldButton"]',
  )) {
    extra.remove();
  }
  for (const tab of copy.querySelectorAll('[data-tab]')) tab.replaceWith(tab.textContent ?? '');
  for (const element of [copy, ...copy.querySelectorAll<HTMLElement>('*')]) {
    if (element === copy) continue;
    // The editor's style decoration marks each paragraph with its named style; the static render has no use for it.
    element.removeAttribute('data-pstyle');
    if (element.hasAttribute('data-scaled')) element.style.removeProperty('margin-inline-end');
    const classes = [...element.classList].filter((name) => !name.startsWith('ProseMirror'));
    if (classes.length > 0) element.className = classes.join(' ');
    else element.removeAttribute('class');
    element.removeAttribute('draggable');
    element.removeAttribute('contenteditable');
    for (const name of element.getAttributeNames().sort()) {
      const value = element.getAttribute(name) ?? '';
      element.removeAttribute(name);
      element.setAttribute(name, value);
    }
    const declarations = element.hasAttribute('style') ? element.style.cssText : null;
    if (declarations !== null) {
      const sorted = declarations
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean)
        .sort()
        .join('; ');
      if (sorted === '') element.removeAttribute('style');
      else element.setAttribute('style', sorted);
    }
  }
  return [...copy.children].map((child) => child.outerHTML).join('\n');
}

interface Fixture {
  name: string;
  doc: PMNode;
  lists?: unknown;
}

function fixtures(): Fixture[] {
  const out: Fixture[] = [];
  for (const entry of json('inline-v2/cases.json').cases as { name: string; markdown: string }[]) {
    out.push({ name: `inline-v2: ${entry.name}`, doc: parseTextBlock(entry.markdown) });
  }
  for (const entry of json('paras/cases.json').cases as { name: string; file: string }[]) {
    const file = json(`paras/${entry.file}`);
    for (const block of (file.blocks ?? []) as { type: string; data: Record<string, unknown> }[]) {
      if (block.type !== 'text' || typeof block.data.markdown !== 'string') continue;
      out.push({
        name: `paras: ${entry.name}`,
        doc: applyElementData(parseTextBlock(block.data.markdown), block.data),
        lists: block.data.lists,
      });
    }
  }
  return out;
}

describe('static render equals mounted render', () => {
  const all = fixtures();

  it('has fixtures to compare', () => {
    expect(all.filter((f) => f.name.startsWith('inline-v2')).length).toBeGreaterThan(20);
    expect(all.filter((f) => f.name.startsWith('paras')).length).toBeGreaterThan(8);
  });

  for (const fixture of all) {
    it(fixture.name, () => {
      const staticRoot = host();
      renderStatic(fixture.doc, staticRoot, fixture.lists === undefined ? undefined : readLists(fixture.lists));
      const mountedRoot = host();
      editor = createBlockEditor(mountedRoot, fixture.doc, { kind: 'text', block: 'b1', host: testHost() });
      if (fixture.lists !== undefined) editor.view.dispatch(editor.state.tr.setMeta(LISTS_META, fixture.lists));
      expect(normalized(mountedRoot)).toBe(normalized(staticRoot));
      editor.destroy();
      editor = null;
    });
  }
});

// ---- Cost ----

describe('render benchmark', () => {
  const LINES = 400;
  // A typical formatted page: one paragraph in five has paragraph formatting and one line in four has a sized run.
  // The two pages have the same elements; only the formatting differs.
  const line = (i: number, rich: boolean) =>
    [
      `Line ${i} with <span data-size="${rich && i % 4 === 0 ? '11' : 'large'}">some</span>`,
      `words in <u${rich && i % 4 === 1 ? ' data-line="dash"' : ''}>it</u>`,
      rich && i % 4 === 2
        ? '<span data-font="Georgia">and</span> <span data-caps="small">more</span>'
        : '<span data-size="large">and</span> <span data-size="large">more</span>',
      rich && i === 7 ? '<span data-scale="120">scaled words</span>' : '<span data-size="large">scaled words</span>',
      '**bold** text.',
    ].join(' ');
  const plain = Array.from({ length: LINES }, (_, i) => line(i, false));
  const formatted = Array.from({ length: LINES }, (_, i) => line(i, true));
  const border = { top: { style: 'single', width: 1 }, bottom: { style: 'single', width: 1 } };
  const paras = Object.fromEntries(
    Array.from({ length: LINES / 5 }, (_, i) => [
      `p${i * 5}`,
      { align: 'justify', indent: { first: 18 }, after: 6, contextual: true, ...(i % 2 === 0 ? { border } : {}) },
    ]),
  );
  const build = (lines: string[], withParas: boolean) =>
    applyElementData(parseTextBlock(lines.join('\n\n')), {
      ids: Array.from({ length: LINES }, (_, i) => `p${i}`),
      paras: withParas ? paras : {},
    });

  function best(doc: PMNode): number {
    let min = Infinity;
    for (let run = 0; run < 20; run++) {
      const root = host();
      const start = performance.now();
      renderStatic(doc, root);
      min = Math.min(min, performance.now() - start);
      root.remove();
    }
    return min;
  }

  it('does the formatting work, and costs under 1.75 times the same page without it', () => {
    const base = build(plain, false);
    const rich = build(formatted, true);
    const probe = host();
    renderStatic(rich, probe);
    // The page must really hold the work (a render without it would be as fast as the plain page).
    expect(probe.querySelectorAll('[data-border-place]').length).toBeGreaterThan(10);
    expect(probe.querySelectorAll('[data-scaled]').length).toBe(2);
    expect(probe.querySelectorAll('span[style*="font-family"]').length).toBeGreaterThan(50);
    expect(probe.querySelectorAll('p[style*="margin-block-end: 0"]').length).toBeGreaterThan(10);
    probe.remove();
    best(base);
    best(rich);
    const [a, b] = [best(base), best(rich)];
    expect(b).toBeLessThanOrEqual(a * 1.75);
  });
});

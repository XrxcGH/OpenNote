import { describe, expect, it } from 'vitest';
import { ENGLISH_LABELS, strokesByBlock } from '../export/blocks';
import { pageOf, textBlock } from '../testing/build';
import { lecturePage } from '../testing/samples';
import { moveSlide, slideHtml, slideOfBlock, slidesOf, slideTitles } from './slides';

const ctx = (page: ReturnType<typeof pageOf>) => ({
  page,
  assetUrl: () => null,
  labels: ENGLISH_LABELS,
  strokes: strokesByBlock(page.strokes),
});

describe('slides from headings', () => {
  const page = pageOf([
    textBlock('Intro text before any heading.'),
    textBlock('## One\n\nFirst slide.\n\n### Detail\n\nStays on slide one.\n\n## Two\n\nSecond slide.'),
    textBlock('Still slide two.'),
    textBlock('# Three\n\n- a\n- b'),
  ]);

  it('starts a slide at each heading of level 2 or above, and keeps deeper headings inside', () => {
    const slides = slidesOf(page);
    expect(slides.map((s) => s.title)).toEqual(['', 'One', 'Two', 'Three']);
    expect(slides.map((s) => s.level)).toEqual([0, 2, 2, 1]);
    expect(slides[1].parts).toHaveLength(1);
    const html = slideHtml(slides[1], ctx(page));
    expect(html).toContain('<h3>Detail</h3>');
    expect(html).not.toContain('Second slide');
  });

  it('carries the text that follows a heading in a later block onto its slide', () => {
    const slides = slidesOf(page);
    expect(slides[2].blocks).toEqual(['b2', 'b3']);
    expect(slideHtml(slides[2], ctx(page))).toContain('Still slide two.');
  });

  it('limits the split to the chosen heading level', () => {
    expect(slidesOf(page, { headingLevel: 1 }).map((s) => s.title)).toEqual(['', 'Three']);
    expect(slidesOf(page, { headingLevel: 3 }).map((s) => s.title)).toEqual(['', 'One', 'Detail', 'Two', 'Three']);
  });

  it('gives one slide when there is nothing to split, and none for an empty page', () => {
    expect(slidesOf(pageOf([textBlock('Just a paragraph.')]))).toHaveLength(1);
    expect(slidesOf(pageOf([]))).toEqual([]);
    expect(slidesOf(pageOf([textBlock('')]))).toEqual([]);
  });
});

describe('slides from divider lines', () => {
  const page = pageOf([textBlock('Alpha\n\n---\n\nBeta\n\n---\n\n---\n\nGamma'), textBlock('## Heading\n\nDelta')]);

  it('ends a slide at a divider and shows no divider', () => {
    const slides = slidesOf(page, { split: 'dividers' });
    expect(slides).toHaveLength(3);
    expect(slideHtml(slides[0], ctx(page))).not.toContain('<hr');
    expect(slideHtml(slides[2], ctx(page))).toContain('Delta');
  });

  it('skips empty slides between dividers in a row', () => {
    expect(slidesOf(page, { split: 'dividers' }).map((s) => s.blocks)).toEqual([['b1'], ['b1'], ['b1', 'b2']]);
  });

  it('splits at both when asked, and at headings only when asked', () => {
    expect(slidesOf(page).map((s) => s.title)).toEqual(['', '', '', 'Heading']);
    expect(slidesOf(page, { split: 'headings' }).map((s) => s.title)).toEqual(['', 'Heading']);
  });
});

describe('slides and other blocks', () => {
  it('puts tables, images, and drawings on the slide of the block before them', () => {
    const page = pageOf(
      [
        textBlock('## First\n\nText'),
        { type: 'image', data: { asset: 'a1', alt: 'A leaf' } },
        textBlock('## Second'),
        {
          type: 'table',
          data: {
            header: true,
            columns: [{ id: 'c', width: 100 }],
            rows: [{ id: 'r', cells: { c: { markdown: 'x' } } }],
          },
        },
      ],
      { assets: { a1: { file: 'leaf.png', mime: 'image/png', name: 'leaf.png' } } },
    );
    const slides = slidesOf(page);
    expect(slides.map((s) => s.parts.map((p) => (p.kind === 'text' ? 'text' : p.block.type)))).toEqual([
      ['text', 'image'],
      ['text', 'table'],
    ]);
  });

  it('follows the reading order of the page, not the order of the blocks', () => {
    const page = pageOf([
      textBlock('## Lower', { x: 10, y: 300, w: 200 }),
      textBlock('## Upper', { x: 10, y: 20, w: 200 }),
    ]);
    expect(slidesOf(page).map((s) => s.title)).toEqual(['Upper', 'Lower']);
  });

  it('presents a real lecture page with one slide for each section', () => {
    const slides = slidesOf(lecturePage());
    expect(slides.map((s) => s.title)).toEqual([
      'Photosynthesis',
      ...Array.from({ length: 4 }, (_, i) => `Section ${i + 1}: light reactions`),
      'The end',
    ]);
    expect(slides[0].parts.length).toBeGreaterThan(0);
  });
});

describe('moving between slides', () => {
  const page = pageOf([textBlock('## A'), textBlock('## B'), textBlock('## C')]);
  const slides = slidesOf(page);

  it('finds the slide of a block, falling back to the first', () => {
    expect(slideOfBlock(slides, 'b2')).toBe(1);
    expect(slideOfBlock(slides, 'missing')).toBe(0);
  });

  it('steps within the deck', () => {
    expect(moveSlide(0, -1, 3)).toBe(0);
    expect(moveSlide(2, 1, 3)).toBe(2);
    expect(moveSlide(0, 2, 3)).toBe(2);
    expect(moveSlide(0, 1, 0)).toBe(-1);
  });

  it('names slides for a navigator, with a fallback for a slide that has no heading', () => {
    const untitled = slidesOf(pageOf([textBlock('Intro'), textBlock('## B')]));
    expect(slideTitles(untitled, (n) => `Slide ${n}`)).toEqual(['Slide 1', 'B']);
  });

  it('labels a slide for assistive technology and escapes the label', () => {
    const tricky = pageOf([textBlock('## Q "quoted" <b>')]);
    const html = slideHtml(slidesOf(tricky)[0], ctx(tricky));
    expect(html).toContain('aria-label="Q &#34;quoted&#34; &#60;b&#62;"');
  });
});

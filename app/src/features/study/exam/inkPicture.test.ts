// A handwritten answer drawn as an SVG picture for the saved results: each stroke is a path in the answer area's
// pixels, a single point is a dot, and questions with no writing get no picture.
import { describe, expect, it } from 'vitest';
import { tokens } from '../../../theme/tokens';
import { inkPictures, inkSvg } from './inkPicture';
import type { Exam, InkPoint } from './types';
import { DEFAULT_SETTINGS } from './types';

const { text, surface } = tokens.color.light;
const LINE = `fill="none" stroke="${text.primary}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;

describe('handwritten answers as pictures', () => {
  it('draws each stroke as a path, rounded to a tenth of a pixel, on a 640 by 200 card of page color', () => {
    const svg = inkSvg([
      [
        [10, 20],
        [30.04, 40.06],
      ],
      [[5, 5]],
    ]);
    expect(svg).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200">' +
        `<rect width="640" height="200" fill="${surface.page}"/>` +
        `<path d="M10 20L30 40.1" ${LINE}/>` +
        `<path d="M5 5l0.1 0" ${LINE}/>` +
        '</svg>',
    );
  });

  it('draws nothing when there are no strokes', () => {
    expect(inkSvg([])).toBeNull();
    expect(inkSvg([[]])).toBeNull();
  });

  it('makes one picture per written answer, numbered by question, under one heading', () => {
    const question = (id: string) => ({
      id,
      kind: 'short' as const,
      prompt: 'Explain.',
      marks: 1,
      answer: 'Because.',
      guide: [],
      source: { pageId: 'p', title: 'T', topic: 'T' },
    });
    const exam: Exam = {
      id: 'e',
      title: 'E',
      created: '2026-10-29T00:00:00.000Z',
      settings: DEFAULT_SETTINGS,
      questions: [question('a'), question('b'), question('c')],
      engine: 'rules',
    };
    const stroke: InkPoint[] = [
      [1, 1],
      [2, 2],
    ];
    const pictures = inkPictures(exam, { a: { text: 'typed' }, b: { ink: [stroke] }, c: { ink: [stroke] } });
    expect(pictures.map((one) => one.name)).toEqual(['Question 2.svg', 'Question 3.svg']);
    expect(pictures[0]!.label).toBe('## Handwritten answers\n\nQuestion 2, as you wrote it:');
    expect(pictures[1]!.label).toBe('Question 3, as you wrote it:');
    expect(pictures[1]!.alt).toBe('Your handwritten answer to question 3.');
    // 480 wide at the area's 640 by 200 shape: 150 high.
    expect([pictures[0]!.width, pictures[0]!.height]).toEqual([480, 150]);
  });
});

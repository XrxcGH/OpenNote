// A handwritten answer as a picture for the saved results page (ADR 0052). The strokes of the answer area become an
// SVG image: the light theme's ink on its page color, on a card the size of the area. It reads the same in light and
// dark themes, and it prints.
import { t } from '../../../strings/t';
import { tokens } from '../../../theme/tokens';
import type { Answers, Exam, InkPoint } from './types';

/** The answer area's drawing size, which the strokes' points are in. */
export const INK_WIDTH = 640;
export const INK_HEIGHT = 200;
/** The size the picture takes on the results page: the area's shape, so it is not letterboxed. */
export const INK_PAGE_WIDTH = 480;
export const INK_PAGE_HEIGHT = (INK_PAGE_WIDTH * INK_HEIGHT) / INK_WIDTH;

const round = (value: number): string => String(Math.round(value * 10) / 10);

/** The path of one stroke; a single point is a dot. */
function pathOf(stroke: readonly InkPoint[]): string | null {
  const [first, ...rest] = stroke;
  if (!first) return null;
  const start = `M${round(first[0])} ${round(first[1])}`;
  if (rest.length === 0) return `${start}l0.1 0`;
  return start + rest.map(([x, y]) => `L${round(x)} ${round(y)}`).join('');
}

/** The strokes as an SVG document, or null when there are none to draw. */
export function inkSvg(strokes: readonly (readonly InkPoint[])[]): string | null {
  const paths = strokes.map(pathOf).filter((path): path is string => path !== null);
  if (paths.length === 0) return null;
  const size = `width="${INK_WIDTH}" height="${INK_HEIGHT}" viewBox="0 0 ${INK_WIDTH} ${INK_HEIGHT}"`;
  const colors = tokens.color.light;
  const line = `fill="none" stroke="${colors.text.primary}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ${size}>` +
    `<rect width="${INK_WIDTH}" height="${INK_HEIGHT}" fill="${colors.surface.page}"/>` +
    paths.map((d) => `<path d="${d}" ${line}/>`).join('') +
    '</svg>'
  );
}

/** A handwritten answer ready for the results page (save.ts PagePicture). */
export interface InkPictureOf {
  label: string;
  alt: string;
  name: string;
  svg: string;
  width: number;
  height: number;
}

/** The handwritten answers of an exam, in question order, under one heading. Questions with no writing are left out. */
export function inkPictures(exam: Exam, answers: Answers): InkPictureOf[] {
  const pictures: InkPictureOf[] = [];
  exam.questions.forEach((question, at) => {
    const svg = inkSvg(answers[question.id]?.ink ?? []);
    if (!svg) return;
    const number = at + 1;
    const line = t('exams.results.inkLabel', { number });
    pictures.push({
      label: pictures.length === 0 ? `## ${t('exams.results.inkHeading')}\n\n${line}` : line,
      alt: t('exams.results.inkAlt', { number }),
      name: `Question ${number}.svg`,
      svg,
      width: INK_PAGE_WIDTH,
      height: INK_PAGE_HEIGHT,
    });
  });
  return pictures;
}

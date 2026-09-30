// The strokes of the text spike: about 5,000 handwriting-like strokes drawn with perfect-freehand, spread under
// and around the notes. They come from a seeded generator, so the page and the tile worker make the same ones.
import { getStroke } from 'perfect-freehand';
import { seeded } from './text-content';

export interface Stroke {
  path: string;
  color: string;
  /** Bounding box in world pixels: left, top, right, bottom. */
  box: [number, number, number, number];
}

/** Rectangles in world pixels, with the share of strokes each one gets. */
interface Area {
  x: number;
  y: number;
  width: number;
  height: number;
  share: number;
}

const PEN_COLORS = ['#2b2521', '#3949ab', '#a8342a', '#35704a', '#7b3f76', '#2b2521', '#2b2521'];

const AREAS: Area[] = [
  // The page around the short notes, where most handwriting sits.
  { x: 60, y: 60, width: 3100, height: 2700, share: 0.82 },
  // Margin notes and scribbles beside and over the 20-page note.
  { x: 1260, y: 2700, width: 1000, height: 12000, share: 0.18 },
];

type Point = [number, number, number];

/** A cursive-like squiggle: a few loops along a baseline, as a pen would draw a short word. */
function squiggle(random: () => number, x: number, y: number): Point[] {
  const loops = 2 + Math.floor(random() * 4);
  const step = 9 + random() * 6;
  const radius = step * (0.55 + random() * 0.35);
  const height = 0.7 + random() * 0.8;
  const points: Point[] = [];
  const total = loops * 2 * Math.PI;
  for (let t = 0; t <= total; t += Math.PI / 4) {
    const px = x + (step / (2 * Math.PI)) * t - radius * Math.sin(t) * 0.6;
    const py = y - radius * height * (1 - Math.cos(t)) * 0.8 + (random() - 0.5) * 1.5;
    points.push([px, py, 0.5]);
  }
  return points;
}

/** A nearly straight line, such as an underline. */
function line(random: () => number, x: number, y: number, length: number): Point[] {
  const points: Point[] = [];
  for (let t = 0; t <= 1; t += 0.1) points.push([x + t * length, y + (random() - 0.5) * 2, 0.5]);
  return points;
}

/** Turns a perfect-freehand outline into a closed SVG path of quadratic curves. */
export function outlinePath(outline: number[][]): string {
  if (outline.length < 4) return '';
  const mid = (a: number, b: number) => ((a + b) / 2).toFixed(1);
  const [first, second, third] = outline;
  let path = `M${first[0].toFixed(1)},${first[1].toFixed(1)} Q${second[0].toFixed(1)},${second[1].toFixed(1)} `;
  path += `${mid(second[0], third[0])},${mid(second[1], third[1])} T`;
  for (let index = 2; index < outline.length - 1; index++) {
    const [a, b] = [outline[index], outline[index + 1]];
    path += `${mid(a[0], b[0])},${mid(a[1], b[1])} `;
  }
  return `${path}Z`;
}

function toStroke(points: Point[], color: string, size: number): Stroke {
  const outline = getStroke(points, { size, thinning: 0.55, smoothing: 0.5, streamline: 0.4, simulatePressure: true });
  const xs = outline.map((point) => point[0]);
  const ys = outline.map((point) => point[1]);
  const box: Stroke['box'] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  return { path: outlinePath(outline), color, box };
}

/** Writes one line of handwriting: a few words, sometimes underlined. Returns the strokes. */
function handwritingLine(random: () => number, area: Area): Stroke[] {
  const color = PEN_COLORS[Math.floor(random() * PEN_COLORS.length)];
  const size = 2.6 + random() * 1.6;
  let x = area.x + random() * Math.max(1, area.width - 400);
  const y = area.y + 30 + random() * Math.max(1, area.height - 30);
  const start = x;
  const strokes: Stroke[] = [];
  const words = 4 + Math.floor(random() * 6);
  for (let word = 0; word < words; word++) {
    const points = squiggle(random, x, y);
    strokes.push(toStroke(points, color, size));
    x = points[points.length - 1][0] + 10 + random() * 14;
  }
  if (random() < 0.12) strokes.push(toStroke(line(random, start, y + 8, x - start), color, size));
  return strokes;
}

/** Makes `count` strokes spread over the page, the same every run. */
export function makeStrokes(count: number, seed = 5000): Stroke[] {
  const random = seeded(seed);
  const strokes: Stroke[] = [];
  for (const [index, area] of AREAS.entries()) {
    const target = index === AREAS.length - 1 ? count : Math.round(strokes.length + count * area.share);
    while (strokes.length < target) strokes.push(...handwritingLine(random, area));
  }
  return strokes.slice(0, count);
}

/** Whether a stroke's bounding box overlaps the rectangle from (left, top) to (right, bottom), in world pixels. */
export function overlaps(stroke: Stroke, left: number, top: number, right: number, bottom: number): boolean {
  const [x0, y0, x1, y1] = stroke.box;
  return x1 >= left && x0 <= right && y1 >= top && y0 <= bottom;
}

/** The right and bottom edges of all the strokes, in world pixels. */
export function extent(strokes: Stroke[]): [number, number] {
  let [right, bottom] = [0, 0];
  for (const stroke of strokes) {
    right = Math.max(right, stroke.box[2]);
    bottom = Math.max(bottom, stroke.box[3]);
  }
  return [Math.ceil(right), Math.ceil(bottom)];
}

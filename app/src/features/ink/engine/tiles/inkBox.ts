// The box a stroke's ink reaches (architecture 7.6). The stroke index uses the nominal width, which is right for hit
// tests. A tile must redraw everything the ink touches, and a hard press draws wider than the nominal width. A tilted
// pencil draws wider still, and a sharp turn in a sparse path makes the outline swing past the centerline. So this box
// comes from the outline itself, the same polygon the renderer fills, built from the stroke's page-space points.
// It is computed once for each stroke object, like the index's other boxes.

import { boundsOf, grow } from '../../geometry/bounds';
import { widthScale } from '../../geometry/matrix';
import { strokeOutline } from '../../geometry/outline';
import { pagePoints } from '../../geometry/strokeIndex';
import type { Bounds, InkPoint, Stroke } from '../../geometry/types';

/** The box grows by this many page units on every side, so antialiased edge pixels fall inside it. */
export const EDGE_MARGIN = 1;

const cache = new WeakMap<Stroke, Bounds>();

/** The page-space box that holds every pixel the stroke draws. */
export function inkBounds(stroke: Stroke): Bounds {
  let box = cache.get(stroke);
  if (!box) {
    const placed = pagePoints(stroke);
    const points: InkPoint[] = stroke.transform
      ? stroke.points.map((p, i) => ({ ...p, x: placed[i].x, y: placed[i].y }))
      : [...stroke.points];
    const scale = stroke.transform ? widthScale(stroke.transform) : 1;
    const outline = strokeOutline(points, { tool: stroke.tool, width: stroke.width, scale });
    box = grow(boundsOf([...outline, ...placed]), EDGE_MARGIN);
    cache.set(stroke, box);
  }
  return box;
}

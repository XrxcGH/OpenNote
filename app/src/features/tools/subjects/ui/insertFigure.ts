// The one call a subject tool uses to put a diagram on the page as a kit figure block: a timeline, a map, a tree, a
// family chart, a Harris matrix, a stereonet. The block keeps the SVG, its alternative text, a summary, and the
// inputs, so Open in tool reopens the same drawing. It returns whether an open page took it.
import { INSERT_EVENT } from '../../flags';
import { kitFigureData, kitFigureFallback } from '../figure/model';
import type { KitFigureData } from '../figure/model';

/** The figure block's short type; the page maps it to its extension type, ext:org.opennote/kitfigure. */
export const KIT_FIGURE_TYPE = 'kitfigure';

export function insertFigure(figure: KitFigureData): boolean {
  const data = kitFigureData(figure);
  const request = {
    block: { type: KIT_FIGURE_TYPE, data: { ...data } as Record<string, unknown>, fallback: kitFigureFallback(data) },
    handled: false,
  };
  window.dispatchEvent(new CustomEvent(INSERT_EVENT, { detail: request }));
  return request.handled;
}

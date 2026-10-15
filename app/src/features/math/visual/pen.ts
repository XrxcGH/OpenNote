// Pen entry for the visual equation editor (A1-28): the strokes written in its writing area go to the on-device
// recognizer, which gives back LaTeX for the field. It asks to turn handwriting recognition on first, if it is off.
import type { PenMath } from '../../../editor/host';

export const penMath: PenMath = {
  async recognize(strokes) {
    const api = await (await import('../../intel')).loadApi();
    if (!(await api.askToTurnOn('handwriting'))) return null;
    const found = await api.recognizeMath(
      strokes.slice(0, api.MAX_MATH_STROKES).map((points, i) => ({ key: `pen-${i}`, points })),
      api.readWith(api.intelClient),
    );
    return found.latex || null;
  },
};

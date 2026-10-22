// How the page draws math (Phase 10): KaTeX's style sheet and fonts, and the renderer an editor's host hands to its
// math atoms. The page loads this module on the first equation it shows, so pages without math never fetch KaTeX.
import 'katex/dist/katex.min.css';
import { isEnabled } from '../../app/flags';
import type { MathRenderer } from '../../editor/host';
import { liveSolveOn } from '../tools';
import { graphOfLatex, liveAnswer, simplifyLatex, solveLatex } from './actions/actions';
import { openGraphPopup } from './graph/GraphPopup';
import { renderLatex } from './latex/render';
import { penMath } from './visual/pen';
import { visualMath } from './visual/field';

export const mathRenderer: MathRenderer = {
  get actions() {
    return isEnabled('math.actions') ? { simplify: simplifyLatex, solve: solveLatex } : undefined;
  },
  get graph() {
    if (!isEnabled('math.graphPopup')) return undefined;
    // A 3D graph is offered only where 3D graphs are drawn.
    const of = (latex: string) => {
      const found = graphOfLatex(latex);
      return found && (!found.three || isEnabled('math.graph3d')) ? found : null;
    };
    return {
      source: (latex: string) => of(latex)?.source ?? null,
      open: (latex: string, anchor: HTMLElement, insert: (source: string) => void) => {
        const found = of(latex);
        if (found) openGraphPopup({ source: found.source, anchor, insert, equation: latex });
      },
    };
  },
  get live() {
    return liveSolveOn() ? liveAnswer : undefined;
  },
  get pen() {
    return isEnabled('intel.mathInk') ? penMath : undefined;
  },
  get visual() {
    return isEnabled('math.visualEditor') ? visualMath : undefined;
  },
  render(source, display) {
    const drawn = renderLatex(source, { displayMode: display });
    return drawn.ok ? { ok: true, html: drawn.html } : { ok: false, ...drawn.error };
  },
};

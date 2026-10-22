// How the page draws math (Phase 10): KaTeX's style sheet and fonts, and the renderer an editor's host hands to its
// math atoms. The page loads this module on the first equation it shows, so pages without math never fetch KaTeX.
import 'katex/dist/katex.min.css';
import { isEnabled } from '../../app/flags';
import type { MathRenderer } from '../../editor/host';
import { liveSolveChosen } from '../../state/liveMath';
import { graphOfLatex, liveAnswer, simplifyLatex, solveLatex } from './actions/actions';
import { t } from '../../strings/t';
import type { MathStepsView } from '../../editor/host';
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
        if (!found) return;
        void import('./graph/GraphPopup').then((popup) =>
          popup.openGraphPopup({ source: found.source, anchor, insert, equation: latex }),
        );
      },
    };
  },
  get steps() {
    if (!isEnabled('math.steps')) return undefined;
    // The steps load on first use, so equations without them never fetch their code.
    return async (latex: string): Promise<MathStepsView> => {
      const found = (await import('./actions/steps')).stepsLatex(latex);
      if (!found.ok) return { ok: false, message: t(`mathTools.steps.reasons.${found.reason}`) };
      return {
        ok: true,
        title: t(found.kind === 'integral' ? 'mathTools.steps.integralTitle' : 'mathTools.steps.derivativeTitle'),
        steps: found.steps.map((step) => ({ rule: t(`mathTools.steps.rules.${step.rule}`), latex: step.latex })),
        result: found.result,
      };
    };
  },
  get live() {
    return isEnabled('math.liveSolve') && liveSolveChosen() ? liveAnswer : undefined;
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

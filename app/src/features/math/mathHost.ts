// How the page draws math (Phase 10): KaTeX's style sheet and fonts, and the renderer an editor's host hands to its
// math atoms. The page loads this module on the first equation it shows, so pages without math never fetch KaTeX.
import 'katex/dist/katex.min.css';
import { isEnabled } from '../../app/flags';
import type { MathRenderer } from '../../editor/host';
import { liveSolveChosen } from '../../state/liveMath';
import { graphOfLatex, liveAnswer, simplifyLatex, solveLatex } from './actions/actions';
import { t } from '../../strings/t';
import type { MathStep, MathStepsView, MathSuggestion } from '../../editor/host';
import type { Step } from './calculus';
import { renderLatex } from './latex/render';
import { refKey, stripLabels } from '../../editor/equations';
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
      const module = await import('./actions/steps');
      const found = module.stepsLatex(latex);
      const view = (step: Step): MathStep => ({
        name: t(`mathTools.steps.names.${step.rule}`),
        rule: t(`mathTools.steps.rules.${step.rule}`),
        latex: step.latex,
        ...(step.note ? { note: step.note } : {}),
        ...(step.children ? { children: step.children.map(view) } : {}),
      });
      if (!found.ok) {
        const message = t(`mathTools.steps.reasons.${found.reason}`);
        return found.steps.length ? { ok: false, message, steps: found.steps.map(view) } : { ok: false, message };
      }
      const title = t(`mathTools.steps.${found.kind}Title`);
      const name = (step: Step) => t(`mathTools.steps.names.${step.rule}`);
      return {
        ok: true,
        title,
        steps: found.steps.map(view),
        result: found.result,
        block: module.stepsBlock(found.steps, name, found.result, title),
      };
    };
  },
  get suggest() {
    if (!isEnabled('math.liveSolve') || !liveSolveChosen()) return undefined;
    // Only a question that ends in "=" loads the calculus code.
    return async (latex: string): Promise<MathSuggestion | null> =>
      /=\s*$/.test(latex) ? (await import('./calculus')).suggestion(latex, { mode: 'latex' }) : null;
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
    // A reference shows its number from the page (the editor draws it); the label of a numbered equation is not drawn.
    const ref = refKey(source);
    if (ref !== null) return { ok: true, html: `<span>(${ref.replace(/[<>&]/g, '')})</span>` };
    const drawn = renderLatex(stripLabels(source), { displayMode: display });
    return drawn.ok ? { ok: true, html: drawn.html } : { ok: false, ...drawn.error };
  },
};

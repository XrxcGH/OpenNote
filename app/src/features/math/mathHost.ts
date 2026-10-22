// How the page draws math (Phase 10): KaTeX's style sheet and fonts, and the renderer an editor's host hands to its
// math atoms. The page loads this module on the first equation it shows, so pages without math never fetch KaTeX.
import 'katex/dist/katex.min.css';
import { isEnabled } from '../../app/flags';
import type { MathRenderer } from '../../editor/host';
import { simplifyLatex, solveLatex } from './actions/actions';
import { renderLatex } from './latex/render';
import { refKey, stripLabels } from '../../editor/equations';
import { penMath } from './visual/pen';
import { visualMath } from './visual/field';

export const mathRenderer: MathRenderer = {
  get actions() {
    return isEnabled('math.actions') ? { simplify: simplifyLatex, solve: solveLatex } : undefined;
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

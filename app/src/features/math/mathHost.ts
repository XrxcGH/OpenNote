// How the page draws math (Phase 10): KaTeX's style sheet and fonts, and the renderer an editor's host hands to its
// math atoms. The page loads this module on the first equation it shows, so pages without math never fetch KaTeX.
import 'katex/dist/katex.min.css';
import { isEnabled } from '../../app/flags';
import type { MathRenderer } from '../../editor/host';
import { simplifyLatex, solveLatex } from './actions/actions';
import { renderLatex } from './latex/render';

export const mathRenderer: MathRenderer = {
  get actions() {
    return isEnabled('math.actions') ? { simplify: simplifyLatex, solve: solveLatex } : undefined;
  },
  render(source, display) {
    const drawn = renderLatex(source, { displayMode: display });
    return drawn.ok ? { ok: true, html: drawn.html } : { ok: false, ...drawn.error };
  },
};

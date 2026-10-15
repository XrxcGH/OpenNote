// The lines of the shown page's paper, for the drawing tools to snap to. The page view's paper code
// (features/pages/live/controller.ts) sets it from the same lattice it draws, whenever the paper, the view, or the
// header above the first rule changes; the ink view reads it through its host. Null when the paper has no lines.
import type { PaperLattice } from '../../../core/paperLattice';
import { createStore } from '../../../state/store';

export const shownPaper = createStore<PaperLattice | null>(null, 'shown paper lattice');

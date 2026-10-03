// The page selection (ARCHITECTURE.md section 25.4; owner after WP0: WP3). Phase 4's object selection writes
// `blocks`; Phase 5's lasso writes both, so the two never compete.
import type { BlockId } from '../../../services/pages/types';
import { createStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';

export interface PageSelection {
  readonly blocks: readonly BlockId[];
  readonly strokes: readonly string[];
}

export const pageSelection = createStore<PageSelection>({ blocks: [], strokes: [] }, 'page selection');

/** Sets the selection. With `announce`, a screen reader hears how many blocks and strokes are selected. */
export function selectOnPage(next: PageSelection, options: { announce?: boolean } = {}): void {
  pageSelection.set(next);
  if (options.announce) announce(t('page.selection.count', { count: next.blocks.length + next.strokes.length }));
}

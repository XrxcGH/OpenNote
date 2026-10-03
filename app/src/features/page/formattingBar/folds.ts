// Fold state in pageViews (ARCHITECTURE.md section 18.2; owner: WP4). Heading and list folds are device-local view
// state, per page, keyed by block, text, and occurrence. Editors ask for their block's folds as they mount and
// report changes; this keeps the page's folds and writes them to Phase 2's device state.
import { getLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { FoldKey } from '../../../editor/commands/fold';
import type { FoldsDetail, FoldsRequestDetail } from '../../../editor/commands/state';
import type { Platform } from '../../../platform/types';

const saved = new Map<string, FoldKey[]>();

function shownPage(): string | null {
  const location = getLocation();
  return location.view === 'workspace' ? location.pageId : null;
}

function platform(): Platform | null {
  try {
    return commandContext('menu').platform;
  } catch {
    return null;
  }
}

function foldsOf(page: string): FoldKey[] {
  const known = saved.get(page);
  if (known) return known;
  const stored = platform()?.boot.state.pageViews[page]?.folds ?? [];
  saved.set(page, [...stored]);
  return saved.get(page)!;
}

/** Answers an editor's request with the folds saved for its block on the shown page. */
export function provideFolds(detail: FoldsRequestDetail): void {
  const page = shownPage();
  if (!page) return;
  const keys = foldsOf(page).filter((key) => key.block === detail.block);
  if (keys.length > 0) detail.provide(keys);
}

/** Saves a block's folds for the shown page. */
export function saveFolds(detail: FoldsDetail): void {
  const page = shownPage();
  const client = platform();
  if (!page) return;
  const folds = [...foldsOf(page).filter((key) => key.block !== detail.block), ...detail.keys];
  saved.set(page, folds);
  if (!client) return;
  const existing = client.boot.state.pageViews[page];
  const view = existing ? { folds } : { scrollX: 0, scrollY: 0, zoom: 1, view: null, folds, at: Date.now() };
  client.state.update({ pageViews: { [page]: view } });
}

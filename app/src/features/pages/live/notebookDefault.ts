// A new page takes its notebook's layout (format spec 4.5): the page copies the default once and never follows later
// changes. The page view calls this when it attaches. A page is new when it holds no blocks, no ink, and no view
// settings of its own, so a page the person has set up or written on is never touched.
import { getLocation } from '../../../app/location';
import type { MountedPage } from '../../page';
import { mergeLayers, readView, writeView } from '../layout';
import type { PageViewSpec } from '../layout';
import { defaultsOf } from './layoutStore';

/** True for a page with nothing in it and no settings of its own. */
export function isNewPage(mounted: MountedPage): boolean {
  const { initial, ink, readOnly } = mounted.page;
  return (
    readOnly === null &&
    Object.keys(initial.view).length === 0 &&
    initial.blocks.length === 0 &&
    (!ink || (ink.records.length === 0 && !ink.more))
  );
}

/** The view the notebook's default gives a page that has `view`, or null when the notebook has no default. */
export function viewWithDefault(view: PageViewSpec, notebook: string | null): PageViewSpec | null {
  const layer = defaultsOf(notebook);
  return layer ? readView(mergeLayers(writeView(view), layer)).view : null;
}

/** Applies the shown notebook's default to a new page, once. `edit` sends the change as one undo step. */
export function applyNotebookDefault(
  mounted: MountedPage,
  current: () => PageViewSpec,
  edit: (next: PageViewSpec) => void,
): void {
  if (!isNewPage(mounted)) return;
  const location = getLocation();
  const next = viewWithDefault(current(), location.view === 'workspace' ? location.notebookId : null);
  if (next) edit(next);
}

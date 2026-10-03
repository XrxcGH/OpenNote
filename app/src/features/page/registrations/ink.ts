// Phase 5's ink (the ink lane): the pens, the erasers, the lasso, shapes, palm rejection, and the Draw tab. The ink
// view lives in features/ink and can't import the page view, so this file hands it the page view's seams. The ink
// chunk and the seams it needs load with the first page shown, so only these few lines count against start-up.
import { loadInkView } from '../../ink/flags';
import { shownMedia } from '../images/shown';

/** A part of the shown page, followed through the shown page view. */
const part = <T>(pick: (page: NonNullable<ReturnType<typeof shownMedia.get>>) => T) => ({
  get: (): T | null => {
    const page = shownMedia.get();
    return page ? pick(page) : null;
  },
  subscribe: shownMedia.subscribe,
});

let started = false;

function start(): void {
  if (started || !shownMedia.get()) return;
  started = true;
  const seams = Promise.all([loadInkView(), import('../viewport/router'), import('../seams/selectionStore')]);
  // A load that fails, as when a test ends before the chunk arrives, leaves the page without ink tools, not broken.
  void seams
    .then(([{ installInk }, router, selection]) =>
      installInk({
        registerPointerTool: router.registerPointerTool,
        setActiveTool: router.setActiveTool,
        viewport: part((page) => page.viewport),
        queue: part((page) => page.sync),
        page: part((page) => page.page),
        layer: part((page) => page.layer),
        selection: selection.pageSelection,
        select: selection.selectOnPage,
        objectCommand: (command) => shownMedia.get()?.objects.command(command),
      }),
    )
    .catch(() => undefined);
}

shownMedia.subscribe(start);
start();

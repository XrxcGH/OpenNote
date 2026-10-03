// Phase 5's ink (the ink lane): the pens, the erasers, the lasso, shapes, palm rejection, and the Draw tab. The ink
// view lives in features/ink and can't import the page view, so this file hands it the page view's seams. The ink
// chunk loads with the first page shown, so only these few lines count against the start-up bundle.
import { loadInkView } from '../../ink/flags';
import { shownMedia } from '../images/shown';
import { registerPointerTool, setActiveTool } from '../viewport/router';
import { pageSelection, selectOnPage } from '../seams/selectionStore';

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
  void loadInkView().then(({ installInk }) =>
    installInk({
      registerPointerTool,
      setActiveTool,
      viewport: part((page) => page.viewport),
      queue: part((page) => page.sync),
      page: part((page) => page.page),
      layer: part((page) => page.layer),
      selection: pageSelection,
      select: selectOnPage,
      objectCommand: (command) => shownMedia.get()?.objects.command(command),
    }),
  );
}

shownMedia.subscribe(start);
start();

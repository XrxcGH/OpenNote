// Phase 5's ink (the ink lane): the pens, the erasers, the lasso, shapes, palm rejection, and the Draw tab. The ink
// view lives in features/ink and can't import the page view, so this file hands it the page view's seams. It loads
// with the first page shown, so nothing of it counts against the start-up bundle.
import { shownViewport } from '../viewport/shown';

let started = false;

async function install(): Promise<void> {
  const [ink, router, sync, open, mount, selection, shown] = await Promise.all([
    import('../../ink'),
    import('../viewport/router'),
    import('../sync/shown'),
    import('../history/shown'),
    import('../mount'),
    import('../seams/selectionStore'),
    import('../viewport/shown'),
  ]);
  const { installInk } = await ink.loadInkView();
  installInk({
    registerPointerTool: router.registerPointerTool,
    setActiveTool: router.setActiveTool,
    viewport: shown.shownViewport,
    queue: sync.shownQueue,
    page: open.shownPage,
    layer: mount.shownLayer,
    selection: selection.pageSelection,
    select: selection.selectOnPage,
    objectCommand: (command) => shown.shownPage.get()?.objectCommand(command),
  });
}

function start(): void {
  if (started || !shownViewport.get()) return;
  started = true;
  void install();
}

shownViewport.subscribe(start);
start();

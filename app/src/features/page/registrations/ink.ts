// Phase 5's ink (the ink lane): the pens, the erasers, the lasso, shapes, palm rejection, and the Draw tab. The ink
// view lives in features/ink and can't import the page view, so this file hands it the page view's seams. The ink
// chunk and the seams it needs load with the first page shown, so only these few lines count against start-up.
import { loadInkView } from '../../ink/flags';
import { shownMedia } from '../images/shown';
import { setInkStrokeReader } from '../seams/inkStrokes';

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
    .then(([{ installInk, shownStrokeReader }, router, selection]) => {
      setInkStrokeReader(shownStrokeReader);
      return installInk({
        registerPointerTool: router.registerPointerTool,
        setActiveTool: router.setActiveTool,
        viewport: part((page) => page.viewport),
        queue: part((page) => page.sync),
        page: part((page) => page.page),
        layer: part((page) => page.layer),
        selection: selection.pageSelection,
        select: selection.selectOnPage,
        objectCommand: (command) => shownMedia.get()?.objects.command(command),
        handwriting: {
          recognize: (strokes) => import('./inkSeams').then((seams) => seams.recognize(strokes)),
          tidy: (strokes, recognition, operation) =>
            import('./inkSeams').then((seams) => seams.tidy(strokes, recognition, operation)),
        },
        text: {
          hit: (x, y) => import('./inkSeams').then((seams) => seams.hit(x, y)),
          words: (block, a, b) => import('./inkSeams').then((seams) => seams.words(block, a, b)),
          remove: (block, from, to) => import('./inkSeams').then((seams) => seams.remove(block, from, to)),
          insert: (block, pos, text) => import('./inkSeams').then((seams) => seams.insert(block, pos, text)),
          split: (block, pos) => import('./inkSeams').then((seams) => seams.split(block, pos)),
          select: (block, from, to) => import('./inkSeams').then((seams) => seams.select(block, from, to)),
          undo: (block) => import('./inkSeams').then((seams) => seams.undoText(block)),
          paragraph: (block, pos) => import('./inkSeams').then((seams) => seams.paragraph(block, pos)),
        },
        audio: {
          playFrom: (ids) => import('../audio/stamps').then((stamps) => stamps.playFromInk(ids)),
          pause: () =>
            void import('../audio/playback').then((playback) => {
              if (playback.playbackUi.get().status?.state === 'playing') void playback.toggle();
            }),
          setSpeed: (speed) => void import('../audio/playback').then((playback) => playback.setSpeed(speed)),
        },
      });
    })
    .catch(() => undefined);
}

shownMedia.subscribe(start);
start();

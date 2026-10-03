// Pen and touch gestures on the page (design 12.4): a scribble over ink erases it, and a circle around content with a tap
// inside selects it. Each shows a toast with Undo. The detectors are the input folder's; this turns what they find
// into page changes. A circle that holds content waits up to a second for its tap, drawn as ink in the meantime, and
// turns into ink for good when no tap comes.
import { isEnabled } from '../../../app/flags';
import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { ERASE_ALL, eraserSkip, LASSO_EVERYTHING } from '../edits/filters';
import { pointInPolygon } from '../geometry/primitives';
import type { Vec } from '../geometry/types';
import { detectLoop, detectScribble, matchCircleTap, scribbleTargets } from '../input/gestures';
import type { LoopMatch, Tap } from '../input/gestures';
import type { InkStroke } from '../model/types';
import { lassoAll } from '../selection/lassoItems';
import type { InkHost } from './host';
import { blockItems } from './lasso';
import type { InkSurface } from './surface';

/** How long a circle waits for its tap. */
export const CIRCLE_WAIT_MS = 1000;

interface Pending {
  readonly strokes: InkStroke[];
  readonly loop: LoopMatch;
  readonly strokesIn: string[];
  readonly blocksIn: string[];
  /** When the pen lifted, on the pointer events' clock. */
  readonly endAt: number;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly surface: InkSurface;
}

/** What the pen did, as the gesture detectors need it. */
export interface PenStroke {
  readonly strokes: readonly InkStroke[];
  readonly tool: InkStroke['tool'];
  /** When the pen lifted, and the pen-down time and travel of the contact, for a tap. */
  readonly endAt: number;
  readonly downAt: number;
  readonly travelPx: number;
}

export function gesturesOn(which: 'scribbleErase' | 'circleSelect'): boolean {
  return isEnabled('ink.gestures') && getSettings().ink.gestures[which];
}

export function createGestures(host: InkHost) {
  let pending: Pending | null = null;

  const locked = (block: string) => host.layer.get()?.block(block)?.lock !== undefined;

  const commit = async (): Promise<void> => {
    const held = pending;
    pending = null;
    if (!held) return;
    clearTimeout(held.timer);
    held.surface.endPreview();
    held.surface.clearLive();
    await held.surface.add(held.strokes);
  };

  const erased = (count: number) => {
    const queue = host.queue.get();
    showToast({
      id: 'ink-gesture',
      message: t('ink.gestures.erased', { count }),
      action: { label: t('ink.gestures.undo'), run: () => queue?.undo() },
    });
  };

  return {
    /** A pen contact begins at a page point: a circle waits on only if the contact lands inside it. */
    down(at: Vec): void {
      if (pending && !pointInPolygon(at, pending.loop.polygon)) void commit();
    },

    /**
     * A pen stroke finished. Returns true when a gesture took it, so the caller adds nothing: a tap that completes a
     * circle, a scribble that erased ink, or a circle that waits for its tap.
     */
    async ended(pen: PenStroke, surface: InkSurface): Promise<boolean> {
      const waiting = pending;
      if (waiting) {
        const first = pen.strokes[0]?.points[0];
        const tap: Tap = {
          x: first?.x ?? 0,
          y: first?.y ?? 0,
          downTime: pen.downAt,
          upTime: pen.endAt,
          travelPx: pen.travelPx,
        };
        if (pen.strokes.length === 1 && first && matchCircleTap(waiting.loop, waiting.endAt, tap)) {
          pending = null;
          clearTimeout(waiting.timer);
          waiting.surface.endPreview();
          waiting.surface.clearLive();
          // The circle goes away with the selection it made: it was the way to ask for it.
          host.select({ strokes: waiting.strokesIn, blocks: waiting.blocksIn }, { announce: true });
          return true;
        }
        await commit();
      }
      if (pen.strokes.length !== 1 || surface.readOnly) return false;
      const stroke = pen.strokes[0];
      const skip = eraserSkip(ERASE_ALL, locked);
      if (gesturesOn('scribbleErase')) {
        const match = detectScribble(stroke.points, { tool: pen.tool });
        const ids = match ? scribbleTargets(surface.index, match, { skip }) : [];
        if (ids.length > 0) {
          surface.clearLive();
          if (await surface.remove(ids)) erased(ids.length);
          return true;
        }
      }
      if (gesturesOn('circleSelect') && pen.tool !== 'highlighter') {
        const loop = detectLoop(stroke.points);
        if (!loop) return false;
        const items = lassoAll(surface.index, blockItems(host), loop.polygon, {
          filter: LASSO_EVERYTHING,
          mode: 'mostly',
          pixel: 1 / surface.cameraNow().zoom,
        });
        if (items.strokes.length + items.blocks.length === 0) return false;
        surface.preview([], [stroke]);
        surface.clearLive();
        pending = {
          strokes: [stroke],
          loop,
          strokesIn: items.strokes,
          blocksIn: items.blocks,
          endAt: pen.endAt,
          timer: setTimeout(() => void commit(), CIRCLE_WAIT_MS),
          surface,
        };
        return true;
      }
      return false;
    },

    destroy(): void {
      if (pending) void commit();
    },
  };
}

export type Gestures = ReturnType<typeof createGestures>;

/** Two- and three-finger double taps from the palm filter: undo and redo, unless the person turned them off. */
export function handleTouchGesture(host: InkHost, kind: 'undo' | 'redo'): void {
  if (!isEnabled('ink.gestures')) return;
  const gestures = getSettings().ink.gestures;
  if (kind === 'undo' ? !gestures.twoFingerUndo : !gestures.threeFingerRedo) return;
  const queue = host.queue.get();
  void (kind === 'undo' ? queue?.undo() : queue?.redo());
  announce(t(kind === 'undo' ? 'ink.gestures.undone' : 'ink.gestures.redone'));
}

// The delegated ink trail (ADR 0004, flag ink.delegatedTrail): while the pen is down, the browser's compositor draws a
// short trail behind the pen tip ahead of the page, which hides the frames the canvas needs to catch up. The page asks
// for a presenter over the ink area and tells it where the stroke's start of the not-yet-drawn part is, with the last
// trusted pointer event and the pen's color and width. Where the browser has no `navigator.ink`, or the flag is off,
// nothing happens and the canvas draws alone. The trail is only a hint: the stroke itself is always drawn by the page.

export interface InkTrailStyle {
  readonly color: string;
  readonly diameter: number;
}

export interface InkPresenter {
  updateInkTrailStartPoint(event: PointerEvent, style: InkTrailStyle): void;
}

interface InkApi {
  requestPresenter(options?: { presentationArea?: Element }): Promise<InkPresenter>;
}

/** What a run measured, for the perf harness and the camera check. */
export interface TrailStats {
  readonly supported: boolean;
  readonly updates: number;
  /** Updates skipped because the event was not a trusted pen or touch event. */
  readonly skipped: number;
  readonly totalMs: number;
  readonly maxMs: number;
}

export interface Trail {
  update(event: PointerEvent, color: string, diameter: number): void;
  stats(): TrailStats;
}

/** Asks the browser for a presenter over an area, or null where it has none. */
export async function requestPresenter(area: Element, api?: InkApi): Promise<InkPresenter | null> {
  const ink = api ?? (typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { ink?: InkApi }).ink);
  if (!ink) return null;
  try {
    return await ink.requestPresenter({ presentationArea: area });
  } catch {
    return null;
  }
}

/** A trail over a presenter. A null presenter gives a trail that does nothing and says it is not supported. */
export function createTrail(presenter: InkPresenter | null, now: () => number = () => performance.now()): Trail {
  let updates = 0;
  let skipped = 0;
  let totalMs = 0;
  let maxMs = 0;
  return {
    update(event, color, diameter) {
      if (!presenter) return;
      // The browser draws a trail only for trusted events; a synthetic one is refused with an error.
      if (!event.isTrusted) {
        skipped += 1;
        return;
      }
      const start = now();
      try {
        presenter.updateInkTrailStartPoint(event, { color, diameter: Math.max(1, diameter) });
      } catch {
        skipped += 1;
        return;
      }
      const took = now() - start;
      updates += 1;
      totalMs += took;
      maxMs = Math.max(maxMs, took);
    },
    stats: () => ({ supported: presenter !== null, updates, skipped, totalMs, maxMs }),
  };
}

const trails = new WeakMap<Element, Promise<Trail>>();
let latest: Trail | null = null;

/** What the most recent trail measured, or null when none was asked for. */
export function trailStats(): TrailStats | null {
  return latest?.stats() ?? null;
}

/** The trail for an area, asked for once. */
export function trailFor(area: Element): Promise<Trail> {
  let trail = trails.get(area);
  if (!trail) {
    trail = requestPresenter(area)
      .then((presenter) => createTrail(presenter))
      .then((made) => (latest = made));
    trails.set(area, trail);
  }
  return trail;
}

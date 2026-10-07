// Snapping to the paper in the ink view: the shown page's paper lines, followed from the host, whether shapes snap to
// them now, and the small rings that show where a point snapped. The geometry is in ../snap/paper.ts; the lines come
// from the page view, which draws its paper from the same lattice (core/paperLattice.ts).
import { isEnabled } from '../../../app/flags';
import { createStore } from '../../../state/store';
import { paperSnapFor } from '../snap';
import type { PaperLattice, PaperSnap } from '../snap';
import type { Vec } from '../geometry/types';
import type { InkHost } from './host';
import { inkPrefs } from './prefs';
import type { InkSurface } from './surface';

/** The lines of the shown page's paper, or null for paper with none. */
export const paperNow = createStore<PaperLattice | null>(null, 'ink paper lattice');

/** Follows the page view's paper lines. Returns a function that stops. */
export function followPaper(host: InkHost): () => void {
  const watched = host.paper;
  if (!watched) return () => undefined;
  const sync = () => paperNow.set(watched.get());
  sync();
  const stop = watched.subscribe(sync);
  return () => {
    stop();
    paperNow.set(null);
  };
}

/** True when the page's paper has lines that shapes can snap to. */
export function hasPaperLines(lattice: PaperLattice | null = paperNow.get()): boolean {
  return lattice !== null && isEnabled('ink.paperSnap');
}

/** What shapes snap to now, at this zoom, or null: plain paper, snapping off, or Alt held for this stroke or drag. */
export function paperSnapNow(zoom: number, alt = false): PaperSnap | null {
  if (!isEnabled('ink.paperSnap')) return null;
  return paperSnapFor(paperNow.get(), zoom, { on: inkPrefs.get().paperSnap, alt });
}

/** The marks' size and how long they stay after a shape is placed, in CSS pixels and milliseconds. */
const MARK_PX = 9;
const LINGER_MS = 700;
const FADE_MS = 200;

interface Marks {
  readonly layer: HTMLDivElement;
  points: readonly Vec[];
  timer: ReturnType<typeof setTimeout> | null;
}

const shown = new WeakMap<InkSurface, Marks>();

function reducedMotion(doc: Document): boolean {
  const view = doc.defaultView;
  return (
    (view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false) ||
    doc.documentElement.dataset.motion === 'reduce'
  );
}

function place(surface: InkSurface, marks: Marks): void {
  const { zoom, scrollX, scrollY } = surface.cameraNow();
  const doc = marks.layer.ownerDocument;
  while (marks.layer.children.length > marks.points.length) marks.layer.lastElementChild?.remove();
  while (marks.layer.children.length < marks.points.length) {
    const ring = doc.createElement('div');
    Object.assign(ring.style, {
      position: 'absolute',
      width: `${MARK_PX}px`,
      height: `${MARK_PX}px`,
      borderRadius: '50%',
      boxSizing: 'border-box',
      border: '1.5px solid var(--color-accent-primary)',
      background: 'color-mix(in srgb, var(--color-accent-primary) 16%, transparent)',
    });
    marks.layer.append(ring);
  }
  marks.points.forEach((p, i) => {
    const ring = marks.layer.children[i] as HTMLElement;
    ring.style.left = `${p.x * zoom - scrollX - MARK_PX / 2}px`;
    ring.style.top = `${p.y * zoom - scrollY - MARK_PX / 2}px`;
  });
}

function marksOf(surface: InkSurface): Marks {
  const had = shown.get(surface);
  if (had) return had;
  const layer = surface.chrome.ownerDocument.createElement('div');
  layer.dataset.inkSnapMarks = '';
  // The rings say nothing a screen reader needs: the shape's own announcement says what was made.
  layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', opacity: '0.85' });
  surface.chrome.append(layer);
  const marks: Marks = { layer, points: [], timer: null };
  // The surface removes its chrome, and the rings with it, when the page goes, which ends this listener's work.
  surface.onChange(() => place(surface, marks));
  shown.set(surface, marks);
  return marks;
}

/**
 * Shows a ring at each point that snapped. While a stroke or a drag goes on the rings follow it; with `linger` they
 * stay a moment after the shape is placed and then fade, or just go when reduced motion is on.
 */
export function showSnapMarks(surface: InkSurface, points: readonly Vec[], linger = false): void {
  const marks = marksOf(surface);
  if (marks.timer) clearTimeout(marks.timer);
  marks.timer = null;
  marks.points = points;
  const { style } = marks.layer;
  style.transition = 'none';
  style.opacity = points.length > 0 ? '0.85' : '0';
  place(surface, marks);
  if (!linger || points.length === 0) return;
  marks.timer = setTimeout(() => {
    const doc = marks.layer.ownerDocument;
    if (!reducedMotion(doc)) style.transition = `opacity ${FADE_MS}ms ease-out`;
    style.opacity = '0';
    marks.timer = setTimeout(() => clearSnapMarks(surface), reducedMotion(doc) ? 0 : FADE_MS);
  }, LINGER_MS);
}

/** Takes the rings away. */
export function clearSnapMarks(surface: InkSurface): void {
  const marks = shown.get(surface);
  if (!marks) return;
  if (marks.timer) clearTimeout(marks.timer);
  marks.timer = null;
  marks.points = [];
  place(surface, marks);
}

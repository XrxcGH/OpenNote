// Accuracy metrics (palm README, "Measurement"): the labels are the oracle. Each replayed session is scored per
// contact, then summed per device profile. Rates come with Wilson 95% intervals so a small corpus cannot claim more
// than it shows.

import { PROFILES } from './profiles';
import { labelOf } from './session';
import type { Session } from './session';
import type { ReplayResult } from './replay';

/** Counts for one profile (or one session). Every field but the times is a count; lower is better unless noted. */
export interface Tally {
  sessions: number;
  penStrokes: number;
  /** Contacts labeled with no intent, and those labeled ink, pan, zoom, or scroll, tap, and gesture. */
  nonIntent: number;
  intendedInk: number;
  intendedNav: number;
  intendedTap: number;
  intendedGestures: number;
  /** G1: committed ink from a non-intent contact that stayed committed; and ink taken back late. */
  strayInk: number;
  lateRetracts: number;
  /** G2: provisional ink shown from a non-intent contact, with a pen about and in finger modes; longest shown. */
  strayShownPen: number;
  strayShownTouch: number;
  strayShownMs: number;
  /** G3: camera moved over 1.5 mm or zoomed by a non-intent contact after reverts; and moves that were reverted. */
  strayCamera: number;
  revertedCamera: number;
  /** G4: taps or menus from non-intent contacts, and gestures nobody meant. */
  strayTaps: number;
  strayGestures: number;
  /** G5: pen samples not passed straight to the tool. */
  penLost: number;
  /** G7: intended touch ink dropped or truncated. */
  inkDropped: number;
  inkTruncated: number;
  /** G8: intended scroll, pan, or zoom that never moved the camera; taps and gestures that never fired. */
  navMissed: number;
  tapMissed: number;
  gestureMissed: number;
  /** G9: delays from passing slop to the camera moving, ms. */
  navDelays: number[];
  /** G10: commit delay of intended touch ink, ms, with presence absent and otherwise. */
  commitDelayAbsent: number;
  commitDelay: number;
}

export const emptyTally = (): Tally => ({
  sessions: 0,
  penStrokes: 0,
  nonIntent: 0,
  intendedInk: 0,
  intendedNav: 0,
  intendedTap: 0,
  intendedGestures: 0,
  strayInk: 0,
  lateRetracts: 0,
  strayShownPen: 0,
  strayShownTouch: 0,
  strayShownMs: 0,
  strayCamera: 0,
  revertedCamera: 0,
  strayTaps: 0,
  strayGestures: 0,
  penLost: 0,
  inkDropped: 0,
  inkTruncated: 0,
  navMissed: 0,
  tapMissed: 0,
  gestureMissed: 0,
  navDelays: [],
  commitDelayAbsent: 0,
  commitDelay: 0,
});

const SLOP_MM = 1.5;

/** When each touch contact first moved past slop, and how many samples it had, from the session's events. */
function contactTracks(s: Session): Map<number, { slopAt: number; samples: number }> {
  const out = new Map<number, { slopAt: number; samples: number; x0: number; y0: number }>();
  const k = 1 / s.header.screen.cssPxPerMm;
  for (const e of s.events) {
    if (e.pt !== 'touch' || e.id === undefined) continue;
    let c = out.get(e.id);
    if (!c) {
      c = { slopAt: Number.NaN, samples: 0, x0: e.x ?? 0, y0: e.y ?? 0 };
      out.set(e.id, c);
    }
    if (e.type === 'pointerdown' || e.type === 'pointermove') c.samples++;
    const d = Math.hypot(((e.x ?? 0) - c.x0) * k, ((e.y ?? 0) - c.y0) * k);
    if (Number.isNaN(c.slopAt) && d >= SLOP_MM && e.type === 'pointermove') c.slopAt = e.t;
  }
  return out;
}

/** Scores one replayed session into a tally. */
export function score(session: Session, result: ReplayResult, into: Tally = emptyTally()): Tally {
  const t = into;
  const mm = 1 / result.cssPxPerMm;
  const penSession =
    session.header.settings.fingerDraw !== 'on' && session.labels.some((l) => l.cls === 'pen' && l.id < 100);
  const absent = PROFILES.find((p) => p.id === session.header.profile)?.device.penDigitizer === false;
  const tracks = contactTracks(session);
  t.sessions++;
  t.penStrokes += session.labels.filter((l) => l.cls === 'pen' && l.id < 100).length;
  t.penLost += Math.max(0, result.penSamplesExpected - result.penSamples);
  const gestureMeant = session.labels.some((l) => l.intent === 'gesture');
  if (!gestureMeant) t.strayGestures += result.gestures.length;
  else if (result.gestures.length === 0) t.gestureMissed++;
  for (const [id, c] of result.contacts) {
    const label = labelOf(session, id);
    if (!label) continue;
    const residual = Math.hypot(c.camX, c.camY) * mm > SLOP_MM || Math.abs(c.zoom - 1) > 0.01;
    if (label.intent === 'none') {
      t.nonIntent++;
      const kept = !Number.isNaN(c.committedAt) && !c.uncommitted;
      if (kept) t.strayInk++;
      if (c.uncommitted) t.lateRetracts++;
      if (c.shown > 0) {
        if (penSession) t.strayShownPen++;
        else t.strayShownTouch++;
        const until = Number.isNaN(c.retractedAt) ? c.end : c.retractedAt;
        t.strayShownMs = Math.max(t.strayShownMs, until - c.firstShown);
      }
      if (residual) t.strayCamera++;
      else if (c.peak * mm > SLOP_MM) t.revertedCamera++;
      if (c.tapAllowed || c.menuAllowed) t.strayTaps++;
      continue;
    }
    const track = tracks.get(id);
    if (label.intent === 'ink') {
      t.intendedInk++;
      if (Number.isNaN(c.committedAt) || c.uncommitted) t.inkDropped++;
      else {
        if (track && c.committedPoints < 0.8 * track.samples) t.inkTruncated++;
        const delay = c.committedAt - c.end;
        if (absent) t.commitDelayAbsent = Math.max(t.commitDelayAbsent, delay);
        else t.commitDelay = Math.max(t.commitDelay, delay);
      }
    } else if (label.intent === 'scroll' || label.intent === 'pan' || label.intent === 'zoom') {
      t.intendedNav++;
      if (Number.isNaN(c.startedAt)) t.navMissed++;
      else if (track && !Number.isNaN(track.slopAt)) t.navDelays.push(Math.max(0, c.startedAt - track.slopAt));
    } else if (label.intent === 'tap') {
      t.intendedTap++;
      if (!c.tapAllowed) t.tapMissed++;
    } else if (label.intent === 'gesture') {
      t.intendedGestures++;
    }
  }
  return t;
}

/** The upper end of the Wilson 95% interval for k events in n trials. */
export function wilsonUpper(k: number, n: number, z = 1.96): number {
  if (n === 0) return 0;
  const p = k / n;
  const z2 = z * z;
  const center = p + z2 / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n));
  return Math.min(1, (center + spread) / (1 + z2 / n));
}

export function percentile(values: readonly number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

/** Stray palm actions per pen stroke, Schwarz et al.'s headline number (G11). */
export function strayPerStroke(t: Tally): number {
  const stray = t.strayInk + t.strayShownPen + t.strayCamera + t.strayTaps + t.strayGestures;
  return t.penStrokes === 0 ? 0 : stray / t.penStrokes;
}

/** The gate values for a tally, by gate id. */
export function gateValues(t: Tally): Record<string, number> {
  return {
    G1_strayInk: t.strayInk,
    G2_strayShownPen: t.strayShownPen,
    G2_strayShownTouchRate: t.nonIntent === 0 ? 0 : t.strayShownTouch / t.nonIntent,
    G2_strayShownMs: t.strayShownMs,
    G3_strayCamera: t.strayCamera,
    G4_strayTaps: t.strayTaps + t.strayGestures,
    G5_penLost: t.penLost,
    G7_inkDroppedRate: t.intendedInk === 0 ? 0 : t.inkDropped / t.intendedInk,
    G7_inkTruncated: t.inkTruncated,
    G8_navMissedRate: t.intendedNav === 0 ? 0 : t.navMissed / t.intendedNav,
    G8_tapsMissed: t.tapMissed + t.gestureMissed,
    G9_navDelayP95: percentile(t.navDelays, 0.95),
    G10_commitDelayAbsent: t.commitDelayAbsent,
    G10_commitDelay: t.commitDelay,
    G11_strayPerStroke: strayPerStroke(t),
  };
}

export function merge(a: Tally, b: Tally): Tally {
  const out = emptyTally();
  for (const key of Object.keys(out) as (keyof Tally)[]) {
    if (key === 'navDelays') out.navDelays = [...a.navDelays, ...b.navDelays];
    else if (key === 'strayShownMs' || key === 'commitDelay' || key === 'commitDelayAbsent')
      out[key] = Math.max(a[key], b[key]);
    else out[key] = a[key] + b[key];
  }
  return out;
}

// Every constant of the palm classifier, with where it comes from. Sizes and distances are millimeters on the glass,
// times are milliseconds on the event clock. A [V] marks a start value that recordings must confirm before release
// (README, "Measurement"). Sources: [S16] ChromeOS palm filter, [S28] Schwarz et al. 2014, [S29] Annett et al. 2014,
// [S30] Vogel et al. 2009, [S6] Android palm rejection. The full list is in the README.

// Contact size (evidence E1 to E4).
/** E1: a contact this long, or `PALM_MINOR_MM` across, is a palm. Architecture 5.5. */
export const PALM_MAJOR_MM = 20;
/** E1 [V]. */
export const PALM_MINOR_MM = 15;
/** E2: a thumb or a flat finger, never rejected on size alone. */
export const LARGE_MAJOR_MM = 14;
/** E3 [V]: a fingertip or a stylus tip. */
export const FINGERTIP_MAJOR_MM = 11;
/** E4 [V]: a palm's area grows after it lands [S28]. Growth of this much, or of `GROWTH_SHARE` past a fingertip. */
export const GROWTH_MM = 4;
export const GROWTH_SHARE = 0.4;
/** "Low" sensitivity raises the E1 sizes by this factor. */
export const LOW_SENSITIVITY_SIZE = 1.15;

// The hand region (E5, E6, E18) [S30].
/** H falls from 1 to 0 over this distance outside the circle. */
export const REGION_FALLOFF_MM = 25;
/** Half the width of the forearm strip beyond the circle. */
export const FOREARM_HALF_MM = 50;
/** Everything this close to the pen tip is the gripping fingers. */
export const TIP_GRIP_MM = 15;
/** E6: a contact this far on the other side of the tip from the hand. */
export const FAR_SIDE_MM = 15;
/** E6: or this far outside the region. */
export const FAR_OUTSIDE_MM = 80;
/** A pen leaning at least this much tells where the hand is. */
export const LEAN_MIN_DEG = 15;
/** [V] How far from the tip the hand center sits along the lean. */
export const LEAN_OFFSET_MM = 60;
/** Weight of each stroke's lean in the hand offset. */
export const LEAN_WEIGHT = 0.3;
/** Weight of each confirmed palm in the learned offset and radius. */
export const LEARN_RATE = 0.2;
export const RADIUS_MIN_MM = 35;
export const RADIUS_MAX_MM = 80;
/** Strokes of contrary lean that overrule an explicit handedness setting. */
export const LEAN_FLIP_STROKES = 5;
/** [V] Default hand offsets from the tip and radii, right-handed; left mirrors x. */
export const PEN_HAND = { ox: 40, oy: 45, r: 50 } as const;
export const TOUCH_HAND = { ox: 25, oy: 30, r: 40 } as const;
/** A contact held this long while the pen is down teaches the hand region. */
export const LEARN_HOLD_MS = 300;

// Timing evidence.
/** E8: the ChromeOS filter cancels touches within 0.4 s of stylus use and holds those within 1 s [S16]. */
export const AFTER_PEN_CANCEL_MS = 400;
export const AFTER_PEN_HOLD_MS = 1000;
/** E9 [V]: a contact this young and this still when a pen arrives landed first [S29]. */
export const PALM_FIRST_AGE_MS = 1500;
export const PALM_FIRST_TRAVEL_MM = 2;
/** E10: still at 150 ms and at 500 ms [S28]. */
export const STILL_MM = 1.5;
export const STILL_EARLY_MS = 150;
export const STILL_LATE_MS = 500;
/** E11 [V]: a swipe. */
export const SWIPE_MM = 3;
export const SWIPE_MS = 200;
export const SWIPE_STRAIGHTNESS = 0.8;
export const LONG_SWIPE_MM = 8;
/** E5 in `recent`: +2 under this long since the pen, else +1. */
export const RECENT_STRONG_MS = 5000;

// Neighbors.
/** E12 [V]: a palm-latched contact this close. */
export const CLUSTER_MM = 70;
/** E13 [V]: adjacent fingertips sit 15 mm or more apart, so two closer contacts are one split blob. */
export const SPLIT_MM = 12;
/** E14 [V]: this many landings within the time and distance below. */
export const BURST_COUNT = 3;
export const BURST_MS = 300;
export const BURST_MM = 90;

// Grip and stylus tips.
/** E15 [S6]: a grip starts this close to a screen edge. */
export const EDGE_MM = 5;
export const GRIP_MAJOR_MM = 12;
export const GRIP_ASPECT = 1.8;
/** E17: a learned passive stylus tip, plus this margin. */
export const TIP_MARGIN_MM = 2;
/** "High" sensitivity with a learned tip draws only within this margin. */
export const TIP_STRICT_MARGIN_MM = 3;
/** Committed strokes that teach the tip size, and the largest mean that counts as a stylus. */
export const TIP_LEARN_STROKES = 5;
export const TIP_STYLUS_MAX_MM = 7;
/** E19: lifted this soon and this still. The existing multi-tap `tapMs`. */
export const TAP_MS = 250;
/** A press longer than this is a long press, not a tap. */
export const LONG_PRESS_MS = 500;

// Verdicts.
export const PALM_SCORE = 4;
export const FINGER_SCORE = 0;
/** An action that has run this long is confirmed: only hard evidence (E1, E4, E16) can stop it. */
export const CONFIRM_MS = 500;
/** Ages at which every live contact is scored again [S28]. */
export const CHECKPOINTS_MS: readonly number[] = [25, 50, 100, 150, 200, 350, 500];
/** A drawing contact is weak: this still at this age, or scoring this much. */
export const WEAK_TRAVEL_MM = 2;
export const WEAK_AGE_MS = 150;
export const WEAK_SCORE = 2;
/** A touch stroke that scores this much at its lift is retracted (a thumb at +1 still draws). */
export const RETRACT_AT_LIFT = 2;

// Motion and pairs.
/** Android touch slop, 8 dp: the camera moves only past this. */
export const SLOP_MM = 1.5;
/** Two contacts pair into a pan within this window; 300 ms when the first has barely moved. */
export const PAIR_WINDOW_MS = 150;
export const PAIR_WINDOW_STILL_MS = 300;
export const PAIR_STILL_MM = 2;
export const PAIR_MIN_MM = 15;
export const PAIR_MAX_MM = 120;
/** Finger spacing for a multi-finger tap. */
export const TAP_MIN_MM = 15;
export const TAP_MAX_MM = 80;
/** [V] A pan: headings within this angle and speeds within this ratio, or a pinch: spacing changed this much. */
export const PAN_HEADING_DEG = 45;
export const PAN_SPEED_RATIO = 3;
export const PINCH_MM = 2;
/** A pan or scroll that began this recently is reverted when the pen goes down. */
export const NAV_REVERT_MS = 500;

// Holds and commits.
/** Touch ink committed this long before a pen arrives, inside its hand region, is taken back [S16]. */
export const LATE_RETRACT_MS = 1000;
/** A held stroke commits this long after its hold ends, so a pen event two frames late still drops it. */
export const COMMIT_SLACK_MS = 32;

// Pen presence.
export const DEFAULT_GRACE_MS = 500;
export const MIN_GRACE_MS = 300;
export const MAX_GRACE_MS = 2000;
/** A hovering pen with no event this long is gone. WebKit reports hover only on change, so it gets longer [V]. */
export const HOVER_WATCHDOG_MS = 2000;
export const WEBKIT_HOVER_WATCHDOG_MS = 5000;
export const MIN_WATCHDOG_MS = 500;
export const MAX_WATCHDOG_MS = 10_000;
/** [V] Pen evidence this recent keeps touch judged against the hand region. */
export const RECENT_MS = 20_000;
/** A pen that left while down and then fell silent this long has gone. */
export const DOWN_LEAVE_MS = 300;
/** [V] A down pen silent this long has gone. */
export const DOWN_SILENCE_MS = 10_000;
/** A contact silent this long lost its end event and is forgotten. */
export const PRUNE_MS = 10_000;

// Units and capacity.
/** [V] CSS px per mm when nothing better is known: iPad, Surface at 150%, and Android at 160 dp/in give 5.2 to 6.3. */
export const DEFAULT_PX_PER_MM = 5.2;
export const MIN_PX_PER_MM = 2;
export const MAX_PX_PER_MM = 20;
/** Size mode is decided after this many contacts report one identical size. */
export const SIZE_MODE_CONTACTS = 8;
export const MAX_CONTACTS = 12;
export const MAX_PENS = 4;
export const MAX_HOLDS = 8;
export const MAX_COMMITS = 4;
export const MAX_LANDINGS = 8;
export const MAX_EFFECTS = 32;
/** A hint matches a contact within this distance and time. */
export const HINT_MM = 2;
export const HINT_MS = 20;

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** A finite number clamped to a range, or the fallback. */
export function clampOr(value: unknown, lo: number, hi: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, lo, hi) : fallback;
}

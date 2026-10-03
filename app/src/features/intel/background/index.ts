// The app's one background queue (Phase 12), with the real computer behind it: input events for idle, the battery for
// power, and the device store for the person's limits. Other parts of the app add work with `enqueueBackground`.
import { intelExt } from '../runtime';
import { createScheduler, DEFAULT_PREFS, IDLE_AFTER_MS } from './scheduler';
import type { BackgroundPrefs, JobSpec, Scheduler, Surroundings } from './scheduler';

export type { BackgroundPrefs, JobInfo, JobKind, JobSpec, JobStatus, WaitReason } from './scheduler';
export { CPU_CHOICES } from './scheduler';

const PREFS_FILE = 'background.json';

interface BatteryLike extends EventTarget {
  charging: boolean;
}

/** The computer as the scheduler asks about it. Without an input event or a battery, it is idle and plugged in. */
function realSurroundings(): Surroundings {
  let lastInput = Date.now();
  let charging = true;
  if (typeof window !== 'undefined') {
    for (const type of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart']) {
      window.addEventListener(
        type,
        () => {
          lastInput = Date.now();
        },
        { passive: true, capture: true },
      );
    }
    const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> }).getBattery;
    void getBattery
      ?.call(navigator)
      .then((battery) => {
        charging = battery.charging;
        battery.addEventListener('chargingchange', () => {
          charging = battery.charging;
          scheduler?.pump();
        });
      })
      .catch(() => undefined);
  }
  return {
    idle: () => Date.now() - lastInput >= IDLE_AFTER_MS,
    pluggedIn: () => charging,
    now: () => Date.now(),
  };
}

let scheduler: Scheduler | null = null;
let loaded: Promise<void> | null = null;

/** The queue, made on first use. */
export function background(): Scheduler {
  scheduler ??= createScheduler(realSurroundings());
  return scheduler;
}

/** Reads the person's limits once. Without a saved file the defaults apply. */
export function loadBackgroundPrefs(): Promise<void> {
  loaded ??= (async () => {
    try {
      const text = await (await intelExt()).get(PREFS_FILE);
      if (text) background().setPrefs(sanitize(JSON.parse(text) as Partial<BackgroundPrefs>));
    } catch {
      // The defaults stay.
    }
  })();
  return loaded;
}

function sanitize(raw: Partial<BackgroundPrefs>): Partial<BackgroundPrefs> {
  const out: Partial<BackgroundPrefs> = {};
  for (const key of ['paused', 'onlyWhenIdle', 'onlyWhenPluggedIn', 'onlyOnRequest'] as const) {
    if (typeof raw[key] === 'boolean') out[key] = raw[key];
  }
  if (typeof raw.cpuPercent === 'number') out.cpuPercent = Math.min(100, Math.max(10, Math.round(raw.cpuPercent)));
  return out;
}

/** Changes the limits and saves them on this device. A failed save keeps the change for this session. */
export async function setBackgroundPrefs(patch: Partial<BackgroundPrefs>): Promise<void> {
  background().setPrefs(patch);
  try {
    await (await intelExt()).put(PREFS_FILE, JSON.stringify(background().state.get().prefs));
  } catch {
    // The limits still apply until the app closes.
  }
}

/** Adds work for the queue. Waits for the person's limits to load first, so an on-request choice is honored. */
export async function enqueueBackground(spec: JobSpec): Promise<boolean> {
  await loadBackgroundPrefs();
  return background().enqueue(spec);
}

/** Tests start over with a queue of their own. */
export function resetBackgroundForTests(next: Scheduler | null = null): void {
  scheduler?.dispose();
  scheduler = next;
  loaded = next ? Promise.resolve() : null;
}

export { DEFAULT_PREFS };

// The clock is injected, so tests control time and the app can choose a source that keeps counting while the
// computer sleeps. Timers store clock readings, so they stay correct across sleep, restarts, and reloads.

/** Returns the current time in epoch milliseconds. */
export type Clock = () => number;

/** Wraps a clock so a reading never goes back, for example when the user sets the system time earlier. */
export function monotonic(read: Clock): Clock {
  let last = -Infinity;
  return () => {
    last = Math.max(last, read());
    return last;
  };
}

/** The wall clock, which keeps counting during sleep. */
export function systemClock(): Clock {
  return monotonic(() => Date.now());
}

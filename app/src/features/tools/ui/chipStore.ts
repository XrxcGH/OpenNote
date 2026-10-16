// What the title bar's timer chip reads. The chip is part of the start-up code, so it holds only this small store;
// the timers fill it in when they load, with a function that says what to show now (or null when none is running).
import { createStore } from '../../../state/store';

export interface ChipReading {
  /** The name of the timer that ends first, or of the only one running. */
  label: string;
  /** Its time left (or counted, for a stopwatch), such as 4:32. */
  text: string;
  /** How many timers are running. */
  count: number;
}

export const timerChip = createStore<{ read: (() => ChipReading | null) | null }>({ read: null }, 'timer chip');

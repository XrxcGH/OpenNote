// A small live wrapper around a timer set and an injected clock. The UI holds one of these, calls its methods,
// and reads views. The state inside stays plain data, so snapshot() can be saved as it is.

import type { Clock } from './clock';
import {
  actOnTimer,
  addTimer,
  EMPTY_TIMER_SET,
  nextWake,
  pauseAll,
  removeTimer,
  renameTimerIn,
  setNotifyIn,
  settleAll,
  viewTimers,
} from './set';
import type { TimerAction, TimerConfig, TimerSet, TimerView } from './types';

export interface Timers {
  add(config: TimerConfig, label?: string): string;
  act(id: string, action: TimerAction): void;
  rename(id: string, label: string): void;
  /** Asks for, or stops asking for, a notification when the timer ends. */
  setNotify(id: string, notify: boolean): void;
  /** Takes in a set another window saved. */
  load(next: TimerSet): void;
  remove(id: string): void;
  pauseAll(): void;
  /** Views of every timer at the current clock reading. */
  views(): TimerView[];
  /** When to call views() again, or null if nothing changes on its own. */
  nextWake(): number | null;
  /** The saved form. Finished timers are marked done first. */
  snapshot(): TimerSet;
  /** Calls the listener after every change. Returns a function that stops it. */
  subscribe(listener: () => void): () => void;
}

export function createTimers(clock: Clock, initial: TimerSet = EMPTY_TIMER_SET): Timers {
  let set = initial;
  const listeners = new Set<() => void>();
  const change = (next: TimerSet) => {
    set = next;
    listeners.forEach((listener) => listener());
  };
  return {
    add(config, label) {
      const added = addTimer(set, config, label);
      change(added.set);
      return added.id;
    },
    act: (id, action) => change(actOnTimer(set, id, action, clock())),
    rename: (id, label) => change(renameTimerIn(set, id, label)),
    setNotify: (id, notify) => change(setNotifyIn(set, id, notify)),
    load: (next) => change(next),
    remove: (id) => change(removeTimer(set, id)),
    pauseAll: () => change(pauseAll(set, clock())),
    views: () => viewTimers(set, clock()),
    nextWake: () => nextWake(set, clock()),
    snapshot: () => settleAll(set, clock()),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

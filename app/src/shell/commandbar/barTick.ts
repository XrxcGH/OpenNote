// A counter that tools bump when what they show changed without a store changing: the selection moved, or text
// took a format. The bar re-reads every tool's state when it changes.
import { createStore } from '../../state/store';

export const barTick = createStore(0, 'command bar tick');

let pending = false;

/** Asks the bar to re-read its tools' states, at most once per frame. */
export function bumpBar(): void {
  if (pending) return;
  pending = true;
  const done = () => {
    pending = false;
    barTick.set(barTick.get() + 1);
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(done);
  else setTimeout(done, 16);
}

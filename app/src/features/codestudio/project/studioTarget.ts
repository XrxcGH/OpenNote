// Which project the Code studio should show, and whether to run it. The page card sets it before it opens the
// studio window; the window (code:L04) reads it and listens for changes. It holds a block ID, never the data.

export interface StudioTarget {
  block: string;
  /** Run the project as soon as the studio has it. */
  run: boolean;
}

let target: StudioTarget | null = null;
const listeners = new Set<(next: StudioTarget | null) => void>();

export function studioTarget(): StudioTarget | null {
  return target;
}

export function setStudioTarget(next: StudioTarget | null): void {
  target = next;
  for (const listener of listeners) listener(next);
}

export function onStudioTarget(listener: (next: StudioTarget | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

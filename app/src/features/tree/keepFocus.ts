// Keeps the keyboard in a tree across an undo or redo. Undoing a new page or a copy removes the focused row, and
// focus then falls to the page body, so the next Ctrl+Y went to the page shown ("Nothing to redo") instead of the
// tree change just undone (full walk A-A02-11, A-A03-1). Focus goes back to the tree's current row instead.

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

/** Runs `change`, then puts focus back in the tree it started in when the change took the focused row away. */
export async function keepTreeFocus<T>(change: () => Promise<T>): Promise<T> {
  const start = typeof document === 'undefined' ? null : document.activeElement;
  const tree = start instanceof HTMLElement ? start.closest<HTMLElement>('[role="tree"]') : null;
  const result = await change();
  if (!tree) return result;
  await nextFrame();
  const now = document.activeElement;
  if (!tree.isConnected || (now && now !== document.body && now.isConnected)) return result;
  const row =
    tree.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"]') ??
    tree.querySelector<HTMLElement>('[role="treeitem"]');
  (row ?? tree).focus({ preventScroll: true });
  return result;
}

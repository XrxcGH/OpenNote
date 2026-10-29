// The frame bar's actions that act on ink alone: they hide while only text boxes or pictures are selected.
const INK_ONLY = [
  'recolor',
  'thicker',
  'thinner',
  'convert',
  'straighten',
  'spacing',
  'anchor',
  'detach',
  'replay',
  'layer',
  'graph',
];

/** Shows the ink-only actions of the bar while ink is selected, and hides them otherwise. */
export function showInkOnlyActions(bar: HTMLElement, ink: boolean): void {
  for (const id of INK_ONLY) {
    const action = bar.querySelector<HTMLElement>(`[data-ink-action="${id}"]`);
    if (action) action.style.display = ink ? '' : 'none';
  }
}

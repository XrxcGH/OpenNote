// The page's default tab interval in points (`view.text.defaultTab`, format section 5.4.2). The page view sets it when
// a page opens or its view changes; the tab layout, the indent commands, and the Format pane read it here.
export const DEFAULT_TAB_POINTS = 36;
export const MIN_DEFAULT_TAB = 1;
export const MAX_DEFAULT_TAB = 1584;

let current = DEFAULT_TAB_POINTS;
const listeners = new Set<() => void>();

/** The interval now in force. */
export const getDefaultTab = (): number => current;

/** The interval a page's `view` saves, or the default when it saves none or a value out of range. */
export function readDefaultTab(view: unknown): number {
  const value = (view as { text?: { defaultTab?: unknown } } | null | undefined)?.text?.defaultTab;
  return typeof value === 'number' && value >= MIN_DEFAULT_TAB && value <= MAX_DEFAULT_TAB ? value : DEFAULT_TAB_POINTS;
}

/** Sets the interval in force. Returns false for a value out of range. */
export function setDefaultTab(points: number): boolean {
  if (!(points >= MIN_DEFAULT_TAB && points <= MAX_DEFAULT_TAB)) return false;
  if (points !== current) {
    current = points;
    for (const listener of [...listeners]) listener();
  }
  return true;
}

/** Calls the listener when the interval changes. */
export function onDefaultTab(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

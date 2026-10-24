// Which window this script runs in. The shell names a page or quick capture window in `__OPENNOTE_WINDOW__`, and a
// popped-out tool in `__OPENNOTE_TOOL__` (or `?tool=`); anything else is the main window. Work that belongs to the
// app as a whole (tracking tabs, the jump list, rename plans, the meeting prompt) runs in the main window only.
export type WindowKind = 'main' | 'tool' | 'page' | 'capture';

export function windowKind(): WindowKind {
  if (typeof window === 'undefined') return 'main';
  const scope = window as { __OPENNOTE_WINDOW__?: { kind?: string }; __OPENNOTE_TOOL__?: string };
  if (scope.__OPENNOTE_TOOL__ || new URLSearchParams(window.location.search).get('tool')) return 'tool';
  const kind = scope.__OPENNOTE_WINDOW__?.kind;
  if (kind === 'page' || kind === 'capture') return kind;
  return scope.__OPENNOTE_WINDOW__ === undefined ? 'main' : 'page';
}

export const isMainWindow = (): boolean => windowKind() === 'main';

// The dock at the right edge of the page region. Panels that open beside the page sit between the command bar's
// line and the status line. These are tool windows, the linked pages pane, and the sheets. The page shrinks by their width, so
// they never cover page text, the title, the Properties chip, or the scroll bar. --dock-inset-right is that width
// (Workspace.module.css gives the page region a matching margin); a panel that overlays instead reports 0.

const owners = new Map<string, number>();

function apply(): void {
  let total = 0;
  for (const width of owners.values()) total += width;
  document.documentElement.style.setProperty('--dock-inset-right', `${total}px`);
}

/** Sets the width, in CSS px, an owner takes at the right edge; 0 gives the space back. */
export function setDockInset(width: number, owner = 'tools'): void {
  if (width > 0) owners.set(owner, Math.round(width));
  else owners.delete(owner);
  apply();
}

/** The width one owner takes at the right edge now, 0 when it takes none. */
export function dockInsetOf(owner: string): number {
  return owners.get(owner) ?? 0;
}

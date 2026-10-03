// Modal inertness without showModal() (ARCHITECTURE.md section 15.1). While a dialog is open, everything else in
// the document is inert: it can't be focused, clicked, or found by assistive technology. The window's caption
// buttons and the title bar's drag area stay usable, so the window can always be moved, minimized, and closed.
// They opt out with the data-modal-exempt attribute, as do the announcer's live regions, so announcements are
// still heard.

/** The attribute that keeps an element usable while a modal layer is open. */
export const MODAL_EXEMPT_ATTRIBUTE = 'data-modal-exempt';

/**
 * Makes every element outside `keep` inert, except exempt elements and overlays already in the top layer.
 * Returns a function that undoes exactly what it changed.
 */
export function inertOutside(keep: Element): () => void {
  const exempt = [keep, ...document.querySelectorAll(`[${MODAL_EXEMPT_ATTRIBUTE}]`)];
  const changed: HTMLElement[] = [];
  const visit = (parent: Element) => {
    for (const child of parent.children) {
      if (exempt.includes(child) || child.matches(':popover-open')) continue;
      if (exempt.some((element) => child.contains(element))) visit(child);
      else if (child instanceof HTMLElement && !child.inert) {
        child.inert = true;
        changed.push(child);
      }
    }
  };
  visit(document.body);
  return () => changed.forEach((element) => (element.inert = false));
}

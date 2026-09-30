// Helpers for overlays in the browser's top layer (ARCHITECTURE.md section 15.3). Menus and tooltips use
// popover="manual", so they sit above dialogs and every stacking context, and the layer stack decides when they
// close. Anchored overlays use CSS anchor positioning, which follows the anchor as the page scrolls.

import { tokens } from '../theme/tokens';

export function showInTopLayer(element: HTMLElement): void {
  if (!element.matches(':popover-open')) element.showPopover();
}

export function hideFromTopLayer(element: HTMLElement): void {
  if (element.matches(':popover-open')) element.hidePopover();
}

export function supportsAnchors(): boolean {
  return typeof CSS !== 'undefined' && CSS.supports('anchor-name: --a');
}

let anchors = 0;

/**
 * Anchors `floating` to `anchor` with CSS anchor positioning. The anchor keeps any anchor name it already has.
 * Returns a function that removes the added name again.
 */
export function anchorTo(floating: HTMLElement, anchor: HTMLElement): () => void {
  anchors += 1;
  const name = `--ui-anchor-${anchors}`;
  const inline = anchor.style.getPropertyValue('anchor-name');
  const current = getComputedStyle(anchor).getPropertyValue('anchor-name');
  anchor.style.setProperty('anchor-name', current && current !== 'none' ? `${current}, ${name}` : name);
  floating.style.setProperty('position-anchor', name);
  return () => {
    if (inline) anchor.style.setProperty('anchor-name', inline);
    else anchor.style.removeProperty('anchor-name');
  };
}

/**
 * Plays an overlay's closing fade (BRAND.md section 9) on a copy, so the real element can leave at once and
 * focus can move on. The copy is hidden from assistive technology and can't be focused or clicked.
 */
export function playExit(element: Element | null | undefined): void {
  if (!(element instanceof HTMLElement) || !element.isConnected) return;
  const ghost = element.cloneNode(true) as HTMLElement;
  for (const node of [ghost, ...ghost.querySelectorAll('[id]')]) node.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.dataset.exiting = '';
  document.body.append(ghost);
  if (ghost.hasAttribute('popover')) showInTopLayer(ghost);
  const remove = () => ghost.remove();
  ghost.addEventListener('animationend', remove, { once: true });
  setTimeout(remove, tokens.motion.duration.quick * 2);
}

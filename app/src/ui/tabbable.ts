// Which elements Tab reaches, in document order, for focus scopes and dialogs. An element counts when it can
// take focus from the keyboard, isn't disabled or inert, and is rendered and visible.

const CANDIDATES = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'summary',
  '[tabindex]',
  '[contenteditable]:not([contenteditable="false"])',
].join(', ');

export function isTabbable(element: HTMLElement): boolean {
  if (element.tabIndex < 0 || element.closest('[inert]')) return false;
  if ((element as HTMLButtonElement).disabled) return false;
  if (element instanceof HTMLInputElement && element.type === 'hidden') return false;
  return element.checkVisibility({ checkVisibilityCSS: true });
}

export function tabbables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(CANDIDATES)].filter(isTabbable);
}

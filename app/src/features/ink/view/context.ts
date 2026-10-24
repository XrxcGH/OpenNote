// What the Draw tab's components need from the installed view: the page host and the shown page's surface. The
// components are plain functions the command bar renders, so they reach these through here.
import type { InkHost } from './host';
import type { InkSurface } from './surface';

export interface ViewContext {
  readonly host: InkHost;
  readonly surface: () => InkSurface | null;
}

let current: ViewContext | null = null;

export function setViewContext(next: ViewContext | null): void {
  current = next;
}

export function viewContext(): ViewContext | null {
  return current;
}

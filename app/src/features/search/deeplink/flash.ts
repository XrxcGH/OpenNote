// Marking a link's target for a moment. Apart from jump.ts so a test can use it without the page view.
import { unfoldAroundDom } from '../../../editor/commands/fold';
import styles from './deeplink.module.css';

const FLASH_MS = 1800;
const FADE_MS = 500;

/** Scrolls to the element and marks it for a moment. A person who asked for less motion gets the mark, still. */
export function flash(element: Element): void {
  // A target inside a folded heading or list item opens what hides it, so the view has something to scroll to.
  unfoldAroundDom(element);
  element.scrollIntoView({ block: 'center', behavior: 'auto' });
  element.classList.add(styles.reveal);
  setTimeout(() => element.classList.add(styles.fade), FLASH_MS);
  setTimeout(() => element.classList.remove(styles.reveal, styles.fade), FLASH_MS + FADE_MS);
}

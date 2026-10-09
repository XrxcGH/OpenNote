// An edited page.md: finds out whether it has text to bring in, and brings it into the page.
import { shellCall } from '../../platform/shellqol';

/** Whether the page's page.md was edited outside OpenNote in a way that changes the page. */
export async function hasReadableEdits(pageId: string): Promise<boolean> {
  try {
    return (await shellCall<unknown>('external.readable', { pageId })) != null;
  } catch {
    return false;
  }
}

/** Brings the edited text into the page as one undo step; true when the page changed. */
export async function bringInReadable(pageId: string): Promise<boolean> {
  return (await shellCall<boolean>('external.importReadable', { pageId })) === true;
}

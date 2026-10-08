// Attaches the quality-of-life features to a mounted page view. registrations/qol.ts registers this as a mounted
// page hook; it loads after start-up, and each feature checks its own flag on the page's editor host. One feature
// failing to attach never keeps the others, or the page, from working.
import type { MountedPage } from '../mount';
import { attachSaveBack } from '../attachments/saveBack';
import { attachCaret } from './caret';
import { attachLinkTitles } from './linkTitle';
import { attachLock } from './lock';
import { attachTypewriter } from './typewriter';
import './editorExtension';

function safely(name: string, attach: () => () => void): () => void {
  try {
    return attach();
  } catch (error) {
    console.error(`The page extra "${name}" could not attach.`, error);
    return () => undefined;
  }
}

export function attachQol(mounted: MountedPage): () => void {
  const stops = [
    safely('reading lock', () => attachLock(mounted)),
    safely('typewriter scrolling', () => attachTypewriter(mounted)),
    safely('caret', () => attachCaret(mounted)),
    safely('link titles', () => attachLinkTitles(mounted)),
    safely('attachments', () => attachSaveBack(mounted)),
  ];
  return () => stops.reverse().forEach((stop) => stop());
}

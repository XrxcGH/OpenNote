// Attaches the quality-of-life features to a mounted page view. registrations/qol.ts registers this as a mounted
// page hook; it loads after start-up, and each feature checks its own flag on the page's editor host.
import type { MountedPage } from '../mount';
import { attachCaret } from './caret';
import { attachLinkTitles } from './linkTitle';
import { attachLock } from './lock';
import { attachTypewriter } from './typewriter';
import './editorExtension';

export function attachQol(mounted: MountedPage): () => void {
  const stops = [attachLock(mounted), attachTypewriter(mounted), attachCaret(mounted), attachLinkTitles(mounted)];
  return () => stops.reverse().forEach((stop) => stop());
}

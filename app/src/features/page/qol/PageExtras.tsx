// The parts of the quality-of-life features that draw inside the page view: the Find bar above the page, the status
// line under it, and the table of contents beside it. PageBody loads this after the page, in one chunk, and puts
// each part where it belongs with `slot`.
import type { MountedPage } from '../mount';
import { FindBar } from '../find/FindBar';
import { TocPane } from '../toc/TocPane';
import { StatusLine } from './StatusLine';

export type ExtrasSlot = 'top' | 'bottom' | 'side';

export default function PageExtras({ mounted, slot }: { mounted: MountedPage; slot: ExtrasSlot }) {
  if (slot === 'top') return <FindBar mounted={mounted} />;
  if (slot === 'bottom') return <StatusLine mounted={mounted} />;
  return <TocPane mounted={mounted} />;
}

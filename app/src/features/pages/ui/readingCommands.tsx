// What the Reading aids command does once it loads.
import { openDialog } from './openDialog';
import { ReadingPanel } from './ReadingPanel';

/** Opens the Reading aids panel. */
export function openReadingAids(): Promise<void> {
  return openDialog((close) => <ReadingPanel close={close} />);
}

// Links to a moment of a recording, such as the time in front of a quoted transcript line. A click on one plays the
// recording from that moment, if the recording is on the page. It loads at start-up, so it only listens: the work loads
// when a link is clicked.
import { parseMomentHref } from './transcripts/model';

/** Starts listening. Answers a function that stops. */
export function installMomentLinks(): () => void {
  if (typeof document === 'undefined') return () => undefined;
  const onClick = (event: MouseEvent) => {
    const link = (event.target as Element | null)?.closest?.('a[href^="opennote:moment/"]');
    const moment = link && parseMomentHref(link.getAttribute('href') ?? '');
    if (!moment || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    void import('./transcripts/actions').then((module) => module.playMs(moment.recording, moment.ms));
  };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}

// Check my work (the dn-stepcheck lane): gathers the lines (lassoed handwriting, the selected typed lines, or the
// whole page), asks the person to confirm handwriting that was hard to read, checks every step on this device, and
// shows the marks. Loads on first use. Nothing leaves the device and nothing on the page changes.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownMedia } from '../images/shown';
import { pageSelection } from '../seams/selectionStore';
import { inkLines, inOrder, typedSelection, type GatheredLine } from './gather';
import { dismissMarks, showMarks } from './overlay';

let running = false;

/** Checks the lassoed handwriting, the selected typed lines, or else the whole page. */
export async function checkMyWork(): Promise<void> {
  const mounted = shownMedia.get();
  if (!mounted || running) return;
  running = true;
  try {
    announce(t('stepCheck.working'));
    const strokes = pageSelection.get().strokes;
    let lines: GatheredLine[];
    if (strokes.length > 0) {
      const read = await inkLines(strokes);
      if (!read.ok) {
        showToast({
          message: t(read.reason === 'off' ? 'stepCheck.errors.handwritingOff' : 'stepCheck.errors.readFailed'),
        });
        return;
      }
      lines = read.lines;
    } else lines = typedSelection(mounted);
    lines = inOrder(lines);
    const { checkSteps, latexToLine } = await (await import('../../math')).loadStepCheck();
    // Handwriting that was hard to read is confirmed first: never judge what was not written.
    const unread = (line: GatheredLine) => line.unsure || (line.from === 'ink' && !line.text.trim());
    if (lines.some(unread)) {
      const { confirmLines } = await import('./ConfirmLines');
      const fixed = await confirmLines(
        lines.map((line) => (line.format === 'latex' ? latexToLine(line.text) : line.text)),
      );
      if (!fixed) return;
      lines = lines.map((line, i) => ({ ...line, text: fixed[i] ?? line.text, format: 'text', unsure: false }));
    }
    const results = checkSteps(lines.map((line) => ({ text: line.text, format: line.format })));
    if (shownMedia.get() !== mounted) return;
    showMarks(mounted, { lines, results }, () => void checkAgain());
    const stop = shownMedia.subscribe(() => {
      if (shownMedia.get() !== mounted) {
        dismissMarks();
        stop();
      }
    });
  } finally {
    running = false;
  }
}

async function checkAgain(): Promise<void> {
  dismissMarks();
  await checkMyWork();
}

// Check my work (the dn-stepcheck lane): gathers the lines (lassoed handwriting, the selected typed lines, or the
// whole page), asks the person to confirm handwriting that was hard to read, checks every step on this device, and
// shows the marks. Loads on first use. Nothing leaves the device and nothing on the page changes.
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownMedia } from '../images/shown';
import type { MountedPage } from '../mount';
import { shownStrokes } from '../seams/inkStrokes';
import { pageSelection } from '../seams/selectionStore';
import { inkLines, inOrder, typedRange, typedSelection, type GatheredLine } from './gather';
import { dismissMarks, showMarks } from './overlay';

/** What a check read: the lassoed strokes, or the selected typed text (null for the whole page). */
type Source = { strokes: readonly string[] } | { range: Range | null };

let running = false;

/** Reasons a handwritten row was not read as math: shown in the confirm dialog for the person to fix. */
const MISREAD = new Set(['unreadable', 'notMath']);

function sourceNow(mounted: MountedPage): Source {
  const { strokes } = pageSelection.get();
  if (strokes.length > 0) return { strokes: [...strokes] };
  return { range: typedRange(mounted)?.cloneRange() ?? null };
}

/** True while the strokes, or the text the range covered, are still on the page. */
function stillThere(source: Source): boolean {
  if ('strokes' in source) return shownStrokes(source.strokes).length > 0;
  const { range } = source;
  return !range || (range.startContainer.isConnected && range.endContainer.isConnected && !range.collapsed);
}

/**
 * Checks the lassoed handwriting, the selected typed lines, or else the whole page. With `again`, the same lines as
 * that check: pressing Check again moves the focus, and with it the selection, so it is not read anew.
 */
export async function checkMyWork(again?: Source): Promise<void> {
  const mounted = shownMedia.get();
  if (!mounted || running) return;
  running = true;
  try {
    announce(t('stepCheck.working'));
    const source = again && stillThere(again) ? again : sourceNow(mounted);
    let lines: GatheredLine[];
    if ('strokes' in source) {
      const read = await inkLines(source.strokes);
      if (!read.ok) {
        showToast({
          message: t(read.reason === 'off' ? 'stepCheck.errors.handwritingOff' : 'stepCheck.errors.readFailed'),
        });
        return;
      }
      lines = read.lines;
    } else lines = typedSelection(mounted, source.range);
    lines = inOrder(lines);
    const { checkSteps, latexToLine } = await (await import('../../math')).loadStepCheck();
    const check = () => checkSteps(lines.map((line) => ({ text: line.text, format: line.format })));
    let results = check();
    // Handwriting that was hard to read, or that the checker could not read as math, is confirmed first: never judge
    // what was not written.
    const unread = (line: GatheredLine, i: number) =>
      line.unsure || (line.from === 'ink' && (!line.text.trim() || MISREAD.has(results[i]?.reason ?? '')));
    if (lines.some(unread)) {
      const { confirmLines } = await import('./ConfirmLines');
      const fixed = await confirmLines(
        lines.map((line) => (line.format === 'latex' ? latexToLine(line.text) : line.text)),
      );
      if (!fixed) return;
      lines = lines.map((line, i) => ({ ...line, text: fixed[i] ?? line.text, format: 'text', unsure: false }));
      results = check();
    }
    if (shownMedia.get() !== mounted) return;
    showMarks(mounted, { lines, results }, () => void checkAgain(source));
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

async function checkAgain(source: Source): Promise<void> {
  dismissMarks();
  await checkMyWork(source);
}

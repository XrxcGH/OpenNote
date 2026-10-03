// Convert handwriting to text (Phase 12): reads the selected strokes on this device and adds the words to the page
// as text, below the last block. The ink stays ink. Loads on first use.
import { isEnabled } from '../../../app/flags';
import { newId } from '../../../editor/ids';
import { escapeParagraphText } from '../../../editor/markdown';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownMedia } from '../images/shown';
import { shownStrokes } from '../seams/inkStrokes';
import { pageSelection } from '../seams/selectionStore';

const intel = () => import('../../intel').then((module) => module.loadApi());

/** The pen layer's strokes for the recognizer: the shown page's, transforms applied, keyed by stroke ID. */
const inkSource = {
  strokes: (ids: readonly string[]) =>
    shownStrokes(ids).map((stroke) => ({
      key: stroke.id,
      points: stroke.points.map((point): [number, number] => [point.x, point.y]),
    })),
};

/** Reads the selected handwriting and adds it to the page as text, below the last block. The ink stays. */
export async function handwritingToText(): Promise<void> {
  const mounted = shownMedia.get();
  const ids = pageSelection.get().strokes;
  if (!mounted || ids.length === 0) return;
  const { readHandwriting, readHandwritingWords, reviewHandwriting, registerInkStrokeSource, hasInkStrokeSource } =
    await intel();
  if (!hasInkStrokeSource()) registerInkStrokeSource(inkSource);
  announce(t('intel.handwriting.working'));
  // With the extras on, the text is tidied first, and any unsure words are reviewed before anything is added.
  let lines: string[] | null;
  if (isEnabled('intel.handwritingExtras')) {
    const recognition = await readHandwritingWords(ids);
    lines = recognition === null ? null : await reviewHandwriting(recognition);
  } else {
    lines = await readHandwriting(ids);
  }
  if (lines === null) return;
  if (lines.length === 0) {
    showToast({ message: t('intel.handwriting.none') });
    return;
  }
  const blocks = [...mounted.viewport.world.querySelectorAll<HTMLElement>('[data-block-id]')];
  const after = blocks.filter((one) => !one.parentElement?.closest('[data-block-id]')).at(-1)?.dataset.blockId;
  const markdown = lines.map((line) => escapeParagraphText(line)).join('\n\n');
  const block = { id: newId(), type: 'text', data: { markdown } };
  await mounted.sync.send({ edits: [{ edit: 'insertBlock', block, ...(after ? { after } : {}) }] });
  showToast({
    message: t('intel.handwriting.inserted'),
    action: { label: t('intel.handwriting.undo'), run: () => mounted.sync.undo() },
  });
}

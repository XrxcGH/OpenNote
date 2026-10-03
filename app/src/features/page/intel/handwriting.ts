// Convert handwriting to text (Phase 12): reads the selected strokes on this device and adds the words to the page
// as text, below the last block. The ink stays ink. Loads on first use.
import { newId } from '../../../editor/ids';
import { escapeParagraphText } from '../../../editor/markdown';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownMedia } from '../images/shown';
import { pageSelection } from '../seams/selectionStore';

const intel = () => import('../../intel').then((module) => module.loadApi());

/** Reads the selected handwriting and adds it to the page as text, below the last block. The ink stays. */
export async function handwritingToText(): Promise<void> {
  const mounted = shownMedia.get();
  const ids = pageSelection.get().strokes;
  if (!mounted || ids.length === 0) return;
  const { readHandwriting } = await intel();
  announce(t('intel.handwriting.working'));
  const lines = await readHandwriting(ids);
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

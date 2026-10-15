// Convert handwriting to math (A1-28): reads the selected strokes as an equation on this device and adds it below the
// page as display math. The ink stays ink. Loads on first use.
import { newId } from '../../../editor/ids';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { shownMedia } from '../images/shown';
import { shownStrokes } from '../seams/inkStrokes';
import { pageSelection } from '../seams/selectionStore';

const intel = () => import('../../intel').then((module) => module.loadApi());

/** Reads the selected handwriting as math and adds it to the page, below the last block. */
export async function convertToMath(): Promise<void> {
  const mounted = shownMedia.get();
  const ids = pageSelection.get().strokes;
  if (!mounted || ids.length === 0) return;
  const api = await intel();
  if (!(await api.askToTurnOn('handwriting'))) return;
  announce(t('intelMore.math.working'));
  const strokes = shownStrokes(ids).map((stroke) => ({
    key: stroke.id,
    points: stroke.points.map((point): [number, number] => [point.x, point.y]),
  }));
  const found = await api.recognizeMath(strokes, api.readWith(api.intelClient));
  if (!found.latex) {
    showToast({ message: t('intelMore.math.none') });
    return;
  }
  const blocks = [...mounted.viewport.world.querySelectorAll<HTMLElement>('[data-block-id]')];
  const after = blocks.filter((one) => !one.parentElement?.closest('[data-block-id]')).at(-1)?.dataset.blockId;
  const block = { id: newId(), type: 'text', data: { markdown: `$$\n${found.latex}\n$$` } };
  await mounted.sync.send({ edits: [{ edit: 'insertBlock', block, ...(after ? { after } : {}) }] });
  showToast({
    message: found.unread > 0 ? t('intelMore.math.unread', { count: found.unread }) : t('intelMore.math.inserted'),
    action: { label: t('intelMore.math.undo'), run: () => mounted.sync.undo() },
  });
}

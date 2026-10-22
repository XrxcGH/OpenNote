// Convert handwriting to math (A1-28): reads the selected strokes as an equation on this device and adds it below the
// page as display math. The ink stays ink. Loads on first use.
import { newId } from '../../../editor/ids';
import type { Edit, NewBlock } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { showInserted } from '../images/insert';
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
  const block: NewBlock = { id: newId(), type: 'text', data: { markdown: `$$\n${found.latex}\n$$` } };
  const edits: Edit[] = [{ edit: 'insertBlock', block, ...(after ? { after } : {}) }];
  const ack = await mounted.sync.send({ edits });
  // The page shows what this window inserted at the order the service gave it.
  showInserted(mounted, edits, ack.orderKeys);
  // The handwriting's answer, such as x = 4, when live solving is on: what was written is checked at a glance.
  const tools = await import('../../tools');
  const answer = tools.liveSolveOn() ? (await import('../../math')).liveAnswer(found.latex) : null;
  showToast({
    message:
      found.unread > 0
        ? t('intelMore.math.unread', { count: found.unread })
        : answer
          ? t('mathTools.live.inkSolved', { answer })
          : t('intelMore.math.inserted'),
    action: { label: t('intelMore.math.undo'), run: () => mounted.sync.undo() },
  });
}

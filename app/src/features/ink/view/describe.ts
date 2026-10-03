// Describe a drawing: a text description for ink, or a mark that it only decorates. It is saved on the ink block, which
// is where the note format keeps `alt` and `decorative`, so page.md and the exports read it from there. A drawing
// area is described on its own; any other ink is the page's ink layer, which this describes.
import type { BlockJson } from '../../../services/pages/types';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { ask } from './ask';
import type { InkHost } from './host';
import type { InkSurface } from './surface';

/** The ink block a description goes to: a selected drawing area, else the page's ink layer. */
export function describedBlock(host: InkHost, surface: InkSurface): BlockJson | null {
  const layer = host.layer.get();
  if (!layer) return null;
  for (const id of host.selection.get().blocks) {
    const block = layer.block(id);
    if (block?.type === 'ink') return block;
  }
  const id = surface.layerBlock;
  return id ? layer.block(id) : null;
}

export async function describeDrawing(host: InkHost, surface: InkSurface): Promise<void> {
  const block = describedBlock(host, surface);
  const queue = host.queue.get();
  if (!block || !queue || surface.readOnly) {
    announce(t('ink.describe.none'));
    return;
  }
  const data = block.data;
  const answer = await ask({
    title: t('ink.describe.title'),
    description: t('ink.describe.description'),
    field: { label: t('ink.describe.label'), value: typeof data.alt === 'string' ? data.alt : '' },
    check: { label: t('ink.describe.decorative'), value: data.decorative === true },
    confirm: t('ink.describe.save'),
  });
  if (!answer) return;
  const decorative = answer.checked;
  const alt = decorative ? '' : answer.text.trim();
  const patch = { alt, decorative };
  const layer = host.layer.get();
  layer?.upsert({ ...block, data: { ...data, ...patch } });
  try {
    await queue.send({ edits: [{ edit: 'patchBlock', block: block.id, data: patch }] });
    announce(t(decorative ? 'ink.describe.markedDecorative' : 'ink.describe.saved'));
  } catch {
    layer?.upsert(block);
    announce(t('ink.errors.notSaved'));
  }
}

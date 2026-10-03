// Summarize this page (Phase 12): hands the page's blocks, in reading order, to the on-device summarizer in
// features/intel, with a way back to each block. Loads on first use.
import { osStore } from '../../../state/os';
import { shownPool } from '../pool/shown';
import { readingSequence } from '../readAloud/sequence';
import { shownViewport } from '../viewport/viewport';

const intel = () => import('../../intel').then((module) => module.loadApi());

/** Brings a block into view and puts the caret at its start, so a keyboard user lands where the summary pointed. */
function reveal(element: Element): () => void {
  return () => {
    const smooth = osStore.get().animations;
    element.scrollIntoView?.({ block: 'center', behavior: smooth ? 'smooth' : 'instant' });
    const block = element.closest<HTMLElement>('[data-block-id]')?.dataset.blockId;
    if (block) shownPool.get()?.mount(block, { kind: 'start' }, 'target');
  };
}

/** Shows a summary of the shown page, each sentence linked to its block. */
export async function summarizePage(): Promise<void> {
  const world = shownViewport.get()?.world;
  if (!world) return;
  const { showPageSummary } = await intel();
  const blocks = readingSequence(world, { readCode: false }).map((item) => ({
    text: item.text,
    reveal: reveal(item.element),
  }));
  await showPageSummary(blocks);
}

// Reading what an embed shows, for exports: the embedded page's text boxes (or the one holding the heading or
// paragraph), as Markdown. The page is opened for a moment and closed again.
import { commandContext } from '../../../commands/registry';
import type { PageId } from '../../../services/pages/types';
import { byOrder } from '../readingOrder/order';
import { pagesClient } from '../runtime';
import type { EmbedText } from './expand';
import { pickBlocks } from './model';
import type { EmbedRef } from './model';

/** The text an embed in `from` shows now, or null when its page or the part of it is not found. */
export async function loadEmbed(ref: EmbedRef, from: string): Promise<EmbedText | null> {
  const { platform } = commandContext('menu');
  const [resolution] = await platform.search.resolve(
    [{ title: ref.title, ...(ref.heading ? { heading: ref.heading } : {}) }],
    from as PageId,
  );
  const target = resolution?.targets[0];
  if (!target || target.page === from) return null;
  const open = await pagesClient().open(target.page as PageId, { viewport: null });
  try {
    const blocks = [...open.initial.blocks].sort(byOrder);
    const sources = blocks.map((block) => ({
      id: block.id,
      type: block.type,
      markdown: typeof block.data.markdown === 'string' ? block.data.markdown : '',
      ids: Array.isArray(block.data.ids) ? block.data.ids.filter((id): id is string => typeof id === 'string') : [],
    }));
    const picked = new Set(pickBlocks(sources, ref.heading, ref.element));
    const markdown = sources
      .filter((block) => picked.has(block.id))
      .map((block) => block.markdown)
      .join('\n\n');
    return { title: target.title || ref.title, markdown };
  } finally {
    await open.close();
  }
}

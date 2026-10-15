// The registrations for players and live embeds: the Insert from link command and its slash item, the embed block's
// renderer, and the paste of a single recognized link into an empty text box. This file loads at start-up, so it holds
// definitions only; the block, the card, and the work load on first use.
import { defineCommand } from '../../../commands/registry';
import type { CommandDef } from '../../../commands/types';
import { commands } from '../../../registries';
import { t } from '../../../strings/t';
import { EMBED_TYPE } from '../media/model';
import { onPaste } from '../media/paste';
import { blockRenderers, slashItems } from '../registries';
import { shownQueue } from '../sync/shown';
import { lazyBlockView } from '../tables/lazyView';

commands.register(
  defineCommand({
    id: 'media.insertFromLink' as CommandDef['id'],
    title: 'accounts.media.commands.insert',
    category: 'insert',
    keywords: 'accounts.media.commands.insertKeywords',
    flag: 'page.mediaEmbeds',
    when: () => shownQueue.get() !== null,
    run: () => import('../media/commands').then((module) => module.insertFromPrompt()),
  } as CommandDef),
);

slashItems.register({
  id: 'mediaEmbed',
  title: 'accounts.media.commands.slash',
  keywords: 'accounts.media.commands.insertKeywords',
  icon: 'MonitorPlay',
  group: 'media',
  order: 40,
  flag: 'page.mediaEmbeds',
  command: 'media.insertFromLink' as CommandDef['id'],
});

blockRenderers.register({
  id: 'embed',
  types: [EMBED_TYPE],
  priority: 1,
  flag: 'page.mediaEmbeds',
  create: (block, ctx) =>
    lazyBlockView(block, ctx, () => import('../media/blockRenderer'), t('accounts.media.block.unavailable')),
});

// A single link pasted into an empty text box becomes the block. A link pasted into words stays a link. The listener
// is added once and costs nothing until a paste.
if (typeof document !== 'undefined') document.addEventListener('paste', onPaste, { capture: true });

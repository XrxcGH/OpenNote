// Storage commands on the page (beta 5): "Open in another editor" (A3-1) hands the shown page's page.md to the
// person's own editor. When that editor saves, the folder watcher keeps the file aside and the page offers to bring
// the changes in (features/qol/BringIn.tsx).

import { defineCommand } from '../../../commands/registry';
import type { CommandContext } from '../../../commands/types';
import { shellCall } from '../../../platform/shellqol';
import { commands, contextMenus } from '../../../registries';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { say } from './say';
import { shownMounted } from '../pagesApi';

/** The shown page, when the command acts on it: no row, or the shown page's own row. */
export function shownPageFor(ctx: CommandContext): string | null {
  const shown = shownMounted.get()?.page.id ?? null;
  if (!shown) return null;
  if (ctx.target?.kind === 'node' && ctx.target.id !== shown) return null;
  return shown;
}

/** Opens the page's page.md in the default editor for Markdown. */
export async function openInAnotherEditor(pageId: string): Promise<boolean> {
  try {
    const answer = await shellCall<{ ok?: boolean } | null>('source.openExternal', { pageId });
    if (!answer?.ok) throw new Error('not opened');
    announce(t('storage.source.opened'));
    return true;
  } catch {
    showToast({ message: t('storage.source.failed'), tone: 'danger' });
    return false;
  }
}

commands.register(
  defineCommand({
    id: 'page.openInEditor',
    title: 'storage.source.openExternal',
    keywords: 'storage.source.keywords',
    category: 'view',
    flag: 'page.markdownSource',
    enabled: (ctx) => shownPageFor(ctx) !== null,
    async run(ctx) {
      const page = shownPageFor(ctx);
      if (page) await openInAnotherEditor(page);
      else say(t('storage.source.noPage'));
    },
  }),
);

contextMenus.register({
  id: 'page.canvas.openInEditor',
  menu: 'page.canvas',
  command: 'page.openInEditor',
  group: 'storage',
  order: 50,
  flag: 'page.markdownSource',
});

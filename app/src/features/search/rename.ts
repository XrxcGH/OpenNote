// Applies the link edits a rename plans. It loads when the index first reports a rename, so start-up carries none
// of it.
import type { Platform } from '../../platform/types';
import type { RenamePlan } from '../../services/search/types';
import { t } from '../../strings/t';
import { announce, confirm, showToast } from '../../ui';
import { applyLinkEdits } from './links/applyEdits';

/** Applies a rename's edits, asking first when they change pages other than the renamed one. */
export async function applyRename(platform: Platform, plan: RenamePlan): Promise<void> {
  if (plan.edits.length === 0) return;
  if (plan.otherPages.length > 0) {
    const ok = await confirm({
      title: t('search.rename.title'),
      body: t('search.rename.body', {
        oldTitle: plan.oldTitle,
        newTitle: plan.newTitle,
        links: plan.edits.length,
        pages: plan.otherPages.length,
      }),
      confirmLabel: t('search.rename.confirm'),
      cancelLabel: t('search.rename.keep'),
    });
    if (!ok) return;
  }
  const applied = await applyLinkEdits(platform.pages, plan.edits);
  if (applied.links > 0) {
    showToast({ message: t('search.rename.done', { links: applied.links, pages: applied.pages }) });
  } else {
    announce(t('search.rename.nothing'));
  }
}

// Takes "Share to OpenNote" shares from the shell's inbox (flag integrations.shareTarget) and adds each one with
// addShare: onto the open page, or into a new page in Quick notes. A share arrives with a launch of the exe, so
// this looks at start-up, when a second launch hands its arguments to this window, and when the window gets the
// focus back. Taking empties the inbox, so a share is added once.
import { isEnabled } from '../../../app/flags';
import type { CommandContext } from '../../../commands/types';
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { shownMounted } from '../../page';
import { openPage } from '../../search';
import { apiHost } from '../api/host';
import { addShare } from './receive';
import type { ShareBlocks, ShareDeps } from './receive';

/** How long a new quick note has to show before its files are pasted in. */
const OPEN_WAIT_MS = 4000;
const STEP_MS = 100;

/** The open page's paste target, or null when no page that can change is shown. */
export function openPageTarget(): EventTarget | null {
  const mounted = shownMounted.get();
  if (!mounted || mounted.page.readOnly) return null;
  return mounted.pool.active()?.editor.view.dom ?? mounted.viewport.sizer;
}

/** Waits for a page to show, and gives its paste target. */
export async function waitForPage(pageId: string, wait = OPEN_WAIT_MS): Promise<EventTarget | null> {
  for (let waited = 0; waited <= wait; waited += STEP_MS) {
    const mounted = shownMounted.get();
    if (mounted?.page.id === pageId) return openPageTarget();
    await new Promise((resolve) => setTimeout(resolve, STEP_MS));
  }
  return null;
}

/** Makes a page in Quick notes through the shell; resolves with its ID, or null when there's nowhere to put it. */
export async function quickNote(
  from: 'share' | 'clip',
  title: string,
  markdown: string,
  sourceUrl: string | null = null,
): Promise<string | null> {
  try {
    const page = await apiHost().call<{ id: string }>('quickNote', { from, title, markdown, sourceUrl });
    return page?.id ?? null;
  } catch {
    return null;
  }
}

/** The steps addShare takes, against the running app. */
export function liveShareDeps(ctx: Pick<CommandContext, 'notes'>): ShareDeps {
  return {
    pasteTarget: openPageTarget,
    quickNote: (title, body) => quickNote('share', title, body),
    openForPaste: async (pageId) => ((await openPage(ctx.notes, pageId)) ? waitForPage(pageId) : null),
  };
}

/** Adds every waiting share and says where each went. */
export async function receiveShares(
  take: () => Promise<ShareBlocks[]>,
  deps: ShareDeps,
  open: (pageId: string) => void = () => undefined,
): Promise<number> {
  let shares: ShareBlocks[];
  try {
    shares = await take();
  } catch {
    return 0;
  }
  for (const share of shares) {
    let made: string | null = null;
    const result = await addShare(share, {
      ...deps,
      quickNote: async (title, body) => (made = await deps.quickNote(title, body)),
    }).catch(() => 'failed' as const);
    if (result === 'page') showToast({ message: t('platformApi.share.addedToPage') });
    else if (result === 'quickNote') {
      const page = made;
      showToast({
        message: t('platformApi.share.addedToQuickNotes'),
        action: page && !deps.pasteTarget() ? { label: t('platformApi.share.open'), run: () => open(page) } : undefined,
      });
    } else if (result === 'none') showToast({ message: t('platformApi.share.nowhere') });
    else showToast({ message: t('platformApi.share.failed'), tone: 'danger' });
  }
  return shares.length;
}

/** Starts listening for shares; returns a function that stops. Off when the flag is off or outside the app. */
export function startShareReceiver(ctx: Pick<CommandContext, 'notes' | 'platform'>): () => void {
  if (!isEnabled('integrations.shareTarget') || import.meta.env.VITE_PLATFORM === 'web') return () => undefined;
  const take = () =>
    import('../../../platform/tauri/localApi').then(({ tauriShareTake }) => tauriShareTake<ShareBlocks>());
  const deps = liveShareDeps(ctx);
  let busy = false;
  const look = () => {
    if (busy) return;
    busy = true;
    void receiveShares(take, deps, (page) => void openPage(ctx.notes, page)).finally(() => (busy = false));
  };
  look();
  const stopArgs = ctx.platform.window.onForwardedArgs(() => setTimeout(look, 300));
  window.addEventListener('focus', look);
  return () => {
    stopArgs();
    window.removeEventListener('focus', look);
  };
}

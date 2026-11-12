// The notice behind the red "Couldn't save" status: which page failed, why in plain words, and what to do. Retry saves
// the shown page now; Copy text puts its text on the clipboard where the page can't be saved at all. What was typed
// stays on the page and in the core's journal the whole time, so the notice never asks for anything before it is safe.
// It stays open while a save is failing and closes itself, with "Saved", once the core saves.

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { saveHealthStore, saveRecovery } from '../../services/pages/saveHealth';
import type { SaveFailure, SaveRecovery } from '../../services/pages/saveHealth';
import { useStore } from '../../state/store';
import { t } from '../../strings/t';
import { announce, Dialog, showToast } from '../../ui';
import type { DialogAction } from '../../ui';
import { getNode } from './store';

const reasons = {
  notFound: () => t('tree.save.notice.reason.notFound'),
  alreadyExists: () => t('tree.save.notice.reason.alreadyExists'),
  busy: () => t('tree.save.notice.reason.busy'),
  readOnlyFile: () => t('tree.save.notice.reason.readOnlyFile'),
  blocked: () => t('tree.save.notice.reason.blocked'),
  diskFull: () => t('tree.save.notice.reason.diskFull'),
  offline: () => t('tree.save.notice.reason.offline'),
  cloudPlaceholder: () => t('tree.save.notice.reason.cloudPlaceholder'),
  tooLarge: () => t('tree.save.notice.reason.tooLarge'),
  unsupported: () => t('tree.save.notice.reason.unsupported'),
} as const;

/** The reason a save failed, in plain words. Unknown kinds say what every other disk trouble says. */
export function saveFailureReason(kind: string): string {
  return kind in reasons ? reasons[kind as keyof typeof reasons]() : t('tree.save.notice.reason.io');
}

/** A busy file passes by itself; any other trouble needs the person, who should be able to keep the text. */
const offersCopy = (failure: SaveFailure): boolean => failure.kind !== 'busy';

/** The failing page to tell about: the shown one first, then the first that failed. */
function pageToShow(failures: ReadonlyMap<string, SaveFailure>, recovery: SaveRecovery | null): string | null {
  const ids = [...failures.keys()];
  return ids.find((id) => recovery?.holds(id)) ?? ids[0] ?? null;
}

function titleOf(failures: ReadonlyMap<string, SaveFailure>, page: string): string {
  if (failures.size > 1) return t('tree.save.notice.titleMany', { count: failures.size });
  const name = getNode(page)?.title;
  return t('tree.save.notice.title', { page: name ? `"${name}"` : t('tree.save.notice.thisPage') });
}

async function copyPageText(recovery: SaveRecovery | null, page: string): Promise<void> {
  try {
    const text = await recovery?.text(page);
    if (text === null || text === undefined) throw new Error('The page is not open here.');
    await navigator.clipboard.writeText(text);
    showToast({ message: t('tree.save.notice.copied') });
  } catch {
    showToast({ message: t('tree.save.notice.copyFailed') });
  }
}

/** Saves the page now. Returns what to tell the person when that did not settle it, or null. */
export async function retryPage(
  recovery: SaveRecovery | null,
  page: string,
  failure: SaveFailure,
): Promise<string | null> {
  try {
    return (await recovery?.retry(page)) === false ? t('tree.save.notice.notOpen') : null;
  } catch {
    // The retry's own failure may have a new reason, which the store has by now.
    const latest = saveHealthStore.get().failures.get(page) ?? failure;
    const text = t('tree.save.notice.stillFailing', { reason: saveFailureReason(latest.kind) });
    announce(text, 'assertive');
    return text;
  }
}

export function SaveNotice({ onClose }: { onClose(): void }) {
  const failures = useStore(saveHealthStore, (state) => state.failures);
  const [retrying, setRetrying] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const recovery = saveRecovery();
  const page = pageToShow(failures, recovery);
  const failure = page ? failures.get(page) : undefined;
  const recovered = failures.size === 0;
  useEffect(() => {
    if (!recovered) return;
    showToast({ message: t('tree.save.notice.recovered') });
    onClose();
  }, [recovered, onClose]);
  if (!page || !failure) return null;

  const retry = async () => {
    setRetrying(true);
    setResult(null);
    setResult(await retryPage(recovery, page, failure));
    setRetrying(false);
  };
  const actions: DialogAction[] = [
    { id: 'close', label: t('tree.save.notice.close'), variant: 'quiet', onPress: onClose },
    ...(recovery?.holds(page) && offersCopy(failure)
      ? [
          {
            id: 'copy',
            label: t('tree.save.notice.copyText'),
            variant: 'secondary',
            onPress: () => copyPageText(recovery, page),
          } as const,
        ]
      : []),
    {
      id: 'retry',
      label: retrying ? t('tree.save.notice.retrying') : t('tree.save.notice.retry'),
      variant: 'primary',
      disabled: retrying,
      onPress: retry,
    },
  ];
  const others = failures.size - 1;
  return (
    <Dialog
      title={titleOf(failures, page)}
      description={saveFailureReason(failure.kind)}
      actions={actions}
      onDismiss={onClose}
    >
      <p role="status">{result}</p>
      <p>{failure.retrying ? t('tree.save.notice.willRetry') : t('tree.save.notice.wontRetry')}</p>
      <p>{t('tree.save.notice.keeping')}</p>
      {others > 0 && <p>{t('tree.save.notice.others', { count: others })}</p>}
    </Dialog>
  );
}

let open = false;

/** Opens the notice over the window. A second call while it is open does nothing. */
export function openSaveNotice(): void {
  if (open) return;
  open = true;
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const close = () => {
    if (!open) return;
    open = false;
    queueMicrotask(() => {
      root.unmount();
      host.remove();
    });
  };
  root.render(<SaveNotice onClose={close} />);
}

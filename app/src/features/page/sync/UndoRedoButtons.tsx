// Undo and Redo as title bar buttons, so they are on screen in every tab and in tablet mode, where there is no
// keyboard for Ctrl+Z and Ctrl+Y. They run what the keys run: the shown page's undo and redo, which cover text and
// ink alike, and when the page has nothing to undo, the tree's (a deleted or moved page).
import { ArrowUUpLeftIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpLeft';
import { ArrowUUpRightIcon } from '@phosphor-icons/react/dist/csr/ArrowUUpRight';
import { useCallback, useSyncExternalStore } from 'react';
import { executeCommand } from '../../../commands/registry';
import { useStore } from '../../../state/store';
import { dismissActionToasts } from '../../../state/toasts';
import { t } from '../../../strings/t';
import { IconButton } from '../../../ui';
import { undoStore } from '../../tree';
import { shownQueue } from './shown';

type Presentation = { presentation: 'full' | 'icon' | 'menuItem' };

/** What the shown page, and failing that the tree, can undo and redo right now. */
export function useHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const queue = useStore(shownQueue, (current) => current);
  const subscribe = useCallback((notify: () => void) => queue?.onUndoState(notify) ?? (() => undefined), [queue]);
  const pageCanUndo = useSyncExternalStore(subscribe, () => queue?.canUndo() ?? false);
  const pageCanRedo = useSyncExternalStore(subscribe, () => queue?.canRedo() ?? false);
  const tree = useStore(undoStore, (state) => state);
  return { canUndo: pageCanUndo || tree.past.length > 0, canRedo: pageCanRedo || tree.future.length > 0 };
}

function runUndo(): void {
  const queue = shownQueue.get();
  if (queue?.canUndo()) {
    dismissActionToasts();
    void queue.undo();
  } else void executeCommand('edit.undo', undefined, 'titleBar');
}

function runRedo(): void {
  const queue = shownQueue.get();
  if (queue?.canRedo()) void queue.redo();
  else void executeCommand('edit.redo', undefined, 'titleBar');
}

export function UndoButton(_props: Presentation) {
  const { canUndo } = useHistoryState();
  return (
    <IconButton
      label={t('pageSync.undo')}
      icon={ArrowUUpLeftIcon}
      command="page.undo"
      disabled={canUndo ? undefined : 'aria'}
      onPress={runUndo}
    />
  );
}

export function RedoButton(_props: Presentation) {
  const { canRedo } = useHistoryState();
  return (
    <IconButton
      label={t('pageSync.redo')}
      icon={ArrowUUpRightIcon}
      command="page.redo"
      disabled={canRedo ? undefined : 'aria'}
      onPress={runRedo}
    />
  );
}

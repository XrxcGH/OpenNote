// The Ctrl+/ dialog, "Keyboard shortcuts": a lazy chunk that shows the shortcut list.

import { t } from '../../strings/t';
import type { OverlayProps } from '../../shell/commandbar/overlays';
import { Dialog } from '../../ui';
import { ShortcutList } from './ShortcutList';

export default function ShortcutsDialog({ onClose }: OverlayProps) {
  return (
    <Dialog
      title={t('shortcuts.title')}
      description={t('shortcuts.description')}
      size="large"
      actions={[{ id: 'close', label: t('common.close'), variant: 'primary', onPress: onClose }]}
      onDismiss={onClose}
    >
      <ShortcutList scrolls />
    </Dialog>
  );
}

// The custom tag dialog: one name, then Add.
import { useState } from 'react';
import type { OverlayProps } from '../../../shell/commandbar/overlays';
import { t } from '../../../strings/t';
import { Dialog, TextField } from '../../../ui';

export default function CustomTag({ onClose, resolve }: OverlayProps & { resolve(name: string | null): void }) {
  const [name, setName] = useState('');
  const finish = (value: string | null) => {
    resolve(value);
    onClose();
  };
  const ready = name.trim().replace(/^#/, '') !== '';
  return (
    <Dialog
      title={t('qolSearch.lineTags.customTitle')}
      description={t('qolSearch.lineTags.customDescription')}
      size="small"
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: () => finish(null) },
        {
          id: 'add',
          label: t('qolSearch.lineTags.customAdd'),
          variant: 'primary',
          onPress: () => (ready ? finish(name) : undefined),
        },
      ]}
      onDismiss={() => finish(null)}
    >
      <TextField
        label={t('qolSearch.lineTags.customName')}
        value={name}
        onChange={setName}
        onCommit={() => (ready ? finish(name) : undefined)}
      />
    </Dialog>
  );
}

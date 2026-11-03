// Opens the recording options in a dialog, for Recording options in the palette and the indicator's panel, so the
// microphone can be changed while a recording runs. The command loads this on first use.
import { Suspense, lazy } from 'react';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import { openDialog } from './dialog';

const Options = lazy(() => import('./OptionsPanel'));

export const openOptions = (): Promise<void> =>
  openDialog((close) => (
    <Dialog
      title={t('audio.options.title')}
      onDismiss={close}
      actions={[{ id: 'close', label: t('audioMore.storage.close'), variant: 'primary', onPress: close }]}
    >
      <Suspense fallback={null}>
        <Options heading={false} />
      </Suspense>
    </Dialog>
  ));

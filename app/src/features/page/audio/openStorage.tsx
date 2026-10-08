// Opens the list of what recordings take. The command loads this on first use, so the screen stays out of start-up.
import { openDialog } from './dialog';
import { StorageDialog } from './StorageDialog';

export const openStorage = (): Promise<void> => openDialog((close) => <StorageDialog onClose={close} />);

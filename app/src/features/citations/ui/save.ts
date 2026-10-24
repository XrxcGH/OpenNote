// Saving text from the Citations window, through the study tools' file saving.
import { showToast } from '../../../ui';
import { t } from '../../../strings/t';
import { saveBytes } from '../../study';

export async function saveText(name: string, text: string, type: string, label: string): Promise<void> {
  try {
    const saved = await saveBytes(name, label, new TextEncoder().encode(text), type);
    if (saved) showToast({ message: t('study.io.exported', { name }) });
  } catch {
    showToast({ message: t('study.io.exportFailed'), tone: 'danger' });
  }
}

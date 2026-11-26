// The one-time tip of PLAN.md decision 4. An older table stores no choice of keys. When it holds a number or a
// formula, it switches to spreadsheet keys. The first time that happens, a toast says so. It names the command that
// gives the table document keys again. The device remembers that it showed the tip.
import { t } from '../../../strings/t';
import { showToast } from '../../../ui/toast';
import type { Texts } from './grid';
import { keysOf, storedKeys } from './mode';

export const KEYS_TIP_KEY = 'opennote.sheetKeys.tipShown';

function shownBefore(): boolean {
  try {
    return localStorage.getItem(KEYS_TIP_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(KEYS_TIP_KEY, '1');
  } catch {
    // The tip may show again in the next session.
  }
}

/** Shows the tip when this table switched to spreadsheet keys on its own and the tip never showed. */
export function keysTip(data: Record<string, unknown>, texts: Texts, useDocumentKeys: () => void): boolean {
  if (storedKeys(data) !== null || keysOf(data, texts) !== 'spreadsheet' || shownBefore()) return false;
  remember();
  showToast({
    id: 'sheetKeysTip',
    message: t('sheetKeys.tip.switched'),
    action: { label: t('sheetKeys.tip.useDocument'), run: useDocumentKeys },
  });
  return true;
}

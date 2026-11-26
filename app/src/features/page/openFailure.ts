// Why a page couldn't open, in words the person can act on (spec 14.5 and 5.7). A damaged page.json can be put back
// from the page's newest saved version, and a page from a newer OpenNote is left unchanged.
import type { PageServiceError } from '../../services/pages/types';
import { t } from '../../strings/t';

export type OpenFailure = 'damaged' | 'newerFormat' | 'other';

export function openFailureOf(error: unknown): OpenFailure {
  const code: string | undefined = (error as Partial<PageServiceError> | null)?.code;
  return code === 'damaged' || code === 'newerFormat' ? code : 'other';
}

export function openFailureText(failure: OpenFailure): string {
  if (failure === 'damaged') return t('page.openDamaged');
  if (failure === 'newerFormat') return t('page.openNewer');
  return t('page.openFailed');
}

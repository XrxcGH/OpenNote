// Words for sizes, progress, and failures, shared by the import and export dialogs.

import type { JobProgress } from '../../platform/interop';
import type { IpcError } from '../../platform/types';
import { t } from '../../strings/t';

const UNITS = [
  ['gigabyte', 1024 ** 3],
  ['megabyte', 1024 ** 2],
  ['kilobyte', 1024],
] as const;

/** A byte count in the largest unit that keeps it above 1, such as "3.2 MB". */
export function sizeText(bytes: number): string {
  const [unit, size] = UNITS.find(([, size]) => bytes >= size) ?? (['byte', 1] as const);
  const value = bytes / size;
  const digits = unit === 'byte' || value >= 10 ? 0 : 1;
  return new Intl.NumberFormat('en-US', {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: digits,
  }).format(value);
}

/** The last part of a path, which is what the person recognizes. */
export function fileName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** How far along a job is, 0 to 100, or undefined while it is not known. */
export function percent(progress: JobProgress | null): number | undefined {
  if (!progress?.total) return undefined;
  return Math.max(0, Math.min(100, Math.round((progress.done / progress.total) * 100)));
}

/** "3 of 12 pages", "3 pages so far", or nothing when the job counts bytes. */
export function progressText(progress: JobProgress | null): string {
  if (!progress || progress.unit !== 'items') return '';
  if (progress.total) {
    return t('interop.import.progressOf', { done: String(progress.done), total: String(progress.total) });
  }
  return t('interop.import.progressDone', { done: progress.done });
}

/** A sentence for a failed import. The host's own words go in only where they help. */
export function importErrorText(error: IpcError): string {
  switch (error.code) {
    case 'unreadable':
      return t('interop.import.failed.unreadable', { detail: error.message });
    case 'io':
      return t('interop.import.failed.io');
    case 'tooBig':
      return t('interop.import.failed.tooBig');
    default:
      return t('interop.import.failed.other', { detail: error.message });
  }
}

/** A sentence for a failed export. */
export function exportErrorText(error: IpcError): string {
  if (error.code === 'io') return t('interop.export.failed.io');
  if (error.code === 'unsupported') return t('interop.export.failed.unsupported');
  return t('interop.export.failed.other', { detail: error.message });
}

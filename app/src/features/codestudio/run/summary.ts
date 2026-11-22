// The console's words for a finished run: its status line and its notes, from strings/en/codeStudio/run.ts.

import type { RunLimits } from '../contracts/run';
import { t } from '../../../strings/t';
import type { RunNote, RunResult } from './host';
import { COMPILE_MS } from './protocol';

const seconds = (ms: number) => (ms / 1000).toFixed(2);

/** The codes a runtime may send as a run's message, and the sentence each one shows as the status line. */
const MESSAGES = {
  compile: 'codeStudio.cpp.compileFailed',
  'compiler-stopped': 'codeStudio.cpp.compilerStopped',
  'no-sources': 'codeStudio.cpp.noSources',
  'pack-missing': 'codeStudio.cpp.packMissing',
  'start-failed': 'codeStudio.cpp.startFailed',
} as const;

/** The status line a run's message code asks for, or null. */
const coded = (message: string): string | null =>
  Object.hasOwn(MESSAGES, message) ? t(MESSAGES[message as keyof typeof MESSAGES]) : null;

/** One line for the end of a run, such as "Ran in 0.12 seconds." */
export function statusLine(result: RunResult, limits: RunLimits): string {
  const code = result.exitCode;
  switch (result.status) {
    case 'ok':
      return code
        ? t('codeStudio.run.status.okExit', { seconds: seconds(result.elapsedMs), code })
        : t('codeStudio.run.status.ok', { seconds: seconds(result.elapsedMs) });
    case 'error':
      if (code) return t('codeStudio.run.status.errorExit', { code });
      return coded(result.message) ?? t('codeStudio.run.status.error');
    case 'time':
      return t('codeStudio.run.status.time', { seconds: Math.round(limits.timeMs / 1000) });
    case 'memory':
      return t('codeStudio.run.status.memory', { megabytes: Math.round(limits.memoryBytes / (1024 * 1024)) });
    case 'stopped':
      return t('codeStudio.run.status.stopped');
    case 'failed':
      if (result.message === 'compile-time')
        return t('codeStudio.cpp.compileTime', { seconds: Math.round(COMPILE_MS / 1000) });
      return coded(result.message) ?? t('codeStudio.run.status.failed');
  }
}

const NOTES = {
  'input-ended': 'codeStudio.run.notes.inputEnded',
  'interactive-unavailable': 'codeStudio.run.notes.interactiveUnavailable',
  'rich-refused': 'codeStudio.run.notes.richRefused',
  'output-cut': 'codeStudio.run.notes.outputCut',
} as const;

/** The sentence for each note of a run. */
export const noteText = (note: RunNote): string => t(NOTES[note]);

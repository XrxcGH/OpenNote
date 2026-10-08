// Running a writing tool on some text: ask to turn the feature on, make the suggestion, show it with the changes
// marked, and hand back the text only when the person accepts it.
import { t } from '../../../strings/t';
import { showToast } from '../../../ui';
import { askToTurnOnExtra } from '../extras';
import { writingEngine } from './ops';
import type { WritingResult, WritingTool } from './ops';

/** The accepted suggestion, or null when the person said not now, canceled, or the tool had nothing to change. */
export async function suggestWriting(tool: WritingTool, text: string): Promise<WritingResult | null> {
  if (!text.trim()) {
    showToast({ message: t('intelPlus.writing.noSelection') });
    return null;
  }
  if (!(await askToTurnOnExtra('writing'))) return null;
  let result: WritingResult;
  try {
    result = await writingEngine().run(tool, text);
  } catch {
    showToast({ message: t('intel.problems.failed'), tone: 'danger' });
    return null;
  }
  const { showSuggestion } = await import('./SuggestionDialog');
  return (await showSuggestion(tool, text, result)) ? result : null;
}

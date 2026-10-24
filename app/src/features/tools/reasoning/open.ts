// Opens the reasoning kit window, at one tool's tab when the palette names one.
import { createStore } from '../../../state/store';
import { openTool } from '../ui/host';
import type { ReasoningToolId } from './meta';

/** The tab the palette asked for, until the window shows it. */
export const reasoningTab = createStore<ReasoningToolId | null>(null, 'reasoning kit tab');

export function openReasoningKit(tool?: ReasoningToolId): void {
  if (tool) reasoningTab.set(tool);
  openTool('kit-reasoning');
}

// Opens the reasoning kit window, at one tool's tab when the palette names one.
import { openTool } from '../ui/host';
import type { ReasoningToolId } from './meta';
import { reasoningTab } from './tab';

export function openReasoningKit(tool?: ReasoningToolId): void {
  if (tool) reasoningTab.set(tool);
  openTool('kit-reasoning');
}

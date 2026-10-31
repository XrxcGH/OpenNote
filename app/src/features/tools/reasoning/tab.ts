// The tab the palette asked the reasoning kit window to show, until the window shows it. Kept apart from open.ts so
// the window does not pull in the tool-window host.
import { createStore } from '../../../state/store';
import type { ReasoningToolId } from './meta';

export const reasoningTab = createStore<ReasoningToolId | null>(null, 'reasoning kit tab');

// Where each reasoning tool's modes load from. Each tool is its own chunk, fetched the first time its tab opens.
import type { ReasoningToolId } from './meta';
import type { ToolSpec } from './ui/types';

const LOADERS: Record<ReasoningToolId, () => Promise<ToolSpec>> = {
  discrete: () => import('./discrete/forms').then((m) => m.DISCRETE),
  digital: () => import('./digital/forms').then((m) => m.DIGITAL),
  games: () => import('./games/forms').then((m) => m.GAMES),
  optimize: () => import('./optimize/forms').then((m) => m.OPTIMIZE),
};

export const loadTool = (tool: ReasoningToolId): Promise<ToolSpec> => LOADERS[tool]();

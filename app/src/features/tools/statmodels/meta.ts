// The tools of the statistical models kit, in the order the window lists them. The registration file and the
// window both read this, so a tool is added here once. It is plain data, because the command palette loads it at
// start-up.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';

export interface StatModelsToolMeta {
  readonly id: string;
  readonly title: MessageKey;
  readonly keywords: MessageKey;
  readonly icon: IconName;
}

export const STATMODELS_TOOLS: readonly StatModelsToolMeta[] = [
  { id: 'glm', title: 'kitStatModels.glm.title', keywords: 'kitStatModels.glm.keywords', icon: 'Function' },
];

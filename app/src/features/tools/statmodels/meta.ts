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
  {
    id: 'regression',
    title: 'kitStatModels.regression.title',
    keywords: 'kitStatModels.regression.keywords',
    icon: 'ChartLine',
  },
  { id: 'glm', title: 'kitStatModels.glm.title', keywords: 'kitStatModels.glm.keywords', icon: 'Function' },
  {
    id: 'causal',
    title: 'kitStatModels.causal.title',
    keywords: 'kitStatModels.causal.keywords',
    icon: 'TreeStructure',
  },
  {
    id: 'survival',
    title: 'kitStatModels.survival.title',
    keywords: 'kitStatModels.survival.keywords',
    icon: 'HourglassMedium',
  },
  {
    id: 'timeseries',
    title: 'kitStatModels.timeseries.title',
    keywords: 'kitStatModels.timeseries.keywords',
    icon: 'ChartLineUp',
  },
  { id: 'spatial', title: 'kitStatModels.spatial.title', keywords: 'kitStatModels.spatial.keywords', icon: 'MapPin' },
];

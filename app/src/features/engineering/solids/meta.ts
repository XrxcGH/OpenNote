// The tools of the solid mechanics kit, in the order the window lists them. The registration file and the window
// both read this, so a tool is added here once. It is plain data, because the command palette loads it at start-up.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';

export interface SolidsToolMeta {
  readonly id: string;
  readonly title: MessageKey;
  readonly keywords: MessageKey;
  readonly icon: IconName;
}

export const SOLIDS_TOOLS: readonly SolidsToolMeta[] = [
  { id: 'columns', title: 'kitSolids.columns.title', keywords: 'kitSolids.columns.keywords', icon: 'Bridge' },
  { id: 'stress', title: 'kitSolids.stress.title', keywords: 'kitSolids.stress.keywords', icon: 'CircleHalf' },
  { id: 'sections', title: 'kitSolids.sections.title', keywords: 'kitSolids.sections.keywords', icon: 'SquareHalf' },
  { id: 'members', title: 'kitSolids.members.title', keywords: 'kitSolids.members.keywords', icon: 'ArrowsClockwise' },
  {
    id: 'deflection',
    title: 'kitSolids.deflection.title',
    keywords: 'kitSolids.deflection.keywords',
    icon: 'ChartLine',
  },
  { id: 'vessels', title: 'kitSolids.vessels.title', keywords: 'kitSolids.vessels.keywords', icon: 'Cylinder' },
  {
    id: 'thinwalled',
    title: 'kitSolids.thinwalled.title',
    keywords: 'kitSolids.thinwalled.keywords',
    icon: 'AirplaneTilt',
  },
];

export const SOLIDS_TOOL_IDS: readonly string[] = SOLIDS_TOOLS.map((tool) => tool.id);

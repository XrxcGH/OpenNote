// The tools of the design kit, in the order the window lists them. The registration file and the window both read
// this, so a tool is added here once. It is plain data, because the command palette loads it at start-up.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';

export interface DesignToolMeta {
  readonly id: string;
  readonly title: MessageKey;
  readonly keywords: MessageKey;
  readonly icon: IconName;
}

export const DESIGN_TOOLS: readonly DesignToolMeta[] = [
  { id: 'tolerances', title: 'kitDesign.tolerances.title', keywords: 'kitDesign.tolerances.keywords', icon: 'Ruler' },
];

export const DESIGN_TOOL_IDS: readonly string[] = DESIGN_TOOLS.map((tool) => tool.id);

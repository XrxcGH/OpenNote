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
  { id: 'drafting', title: 'kitDesign.drafting.title', keywords: 'kitDesign.drafting.keywords', icon: 'PencilRuler' },
  { id: 'views', title: 'kitDesign.views.title', keywords: 'kitDesign.views.keywords', icon: 'Box' },
  { id: 'tolerances', title: 'kitDesign.tolerances.title', keywords: 'kitDesign.tolerances.keywords', icon: 'Ruler' },
  { id: 'machining', title: 'kitDesign.machining.title', keywords: 'kitDesign.machining.keywords', icon: 'Wrench' },
  { id: 'forming', title: 'kitDesign.forming.title', keywords: 'kitDesign.forming.keywords', icon: 'Hammer' },
  { id: 'microfab', title: 'kitDesign.microfab.title', keywords: 'kitDesign.microfab.keywords', icon: 'Cpu' },
  { id: 'memtrace', title: 'kitDesign.memtrace.title', keywords: 'kitDesign.memtrace.keywords', icon: 'Waypoints' },
  { id: 'numrep', title: 'kitDesign.numrep.title', keywords: 'kitDesign.numrep.keywords', icon: 'Binary' },
  {
    id: 'references',
    title: 'kitDesign.references.title',
    keywords: 'kitDesign.references.keywords',
    icon: 'BookOpen',
  },
];

export const DESIGN_TOOL_IDS: readonly string[] = DESIGN_TOOLS.map((tool) => tool.id);

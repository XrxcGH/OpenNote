// The life-systems tools in the order the window lists them: each one's id, its name, and search words in the
// kitLifeSys strings, and its icon. The start-up registration reads this list (through ../flags.ts), so it holds
// names only; each tool's forms and engines load when its tab is first opened (kit.ts).
import type { MessageKey } from '../../../strings/t';

export type LifeSysToolId = 'diversity' | 'bench' | 'demography';

export interface LifeSysMeta {
  id: LifeSysToolId;
  /** The palette command's title, such as Open biodiversity and field sampling. */
  title: MessageKey;
  keywords: MessageKey;
  icon: string;
}

export const LIFESYS_TOOLS: readonly LifeSysMeta[] = [
  {
    id: 'demography',
    title: 'kitLifeSys.tools.demography.open',
    keywords: 'kitLifeSys.tools.demography.keywords',
    icon: 'UsersThree',
  },
  {
    id: 'bench',
    title: 'kitLifeSys.tools.bench.open',
    keywords: 'kitLifeSys.tools.bench.keywords',
    icon: 'TestTube',
  },
  {
    id: 'diversity',
    title: 'kitLifeSys.tools.diversity.open',
    keywords: 'kitLifeSys.tools.diversity.keywords',
    icon: 'Butterfly',
  },
];

export const isLifeSysTool = (value: unknown): value is LifeSysToolId =>
  LIFESYS_TOOLS.some((tool) => tool.id === value);

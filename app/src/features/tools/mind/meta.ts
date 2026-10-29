// The tools of the psychology and behavior kit, in the order the window lists them. The registration file and the
// window both read this, so a tool is added here once. It is plain data, because the command palette loads it at
// start-up.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';

export interface MindToolMeta {
  readonly id: string;
  readonly title: MessageKey;
  readonly keywords: MessageKey;
  readonly icon: IconName;
}

export const MIND_TOOLS: readonly MindToolMeta[] = [
  { id: 'sdt', title: 'kitMind.sdt.title', keywords: 'kitMind.sdt.keywords', icon: 'Eye' },
  { id: 'scales', title: 'kitMind.scales.title', keywords: 'kitMind.scales.keywords', icon: 'ListNumbers' },
  { id: 'agreement', title: 'kitMind.agreement.title', keywords: 'kitMind.agreement.keywords', icon: 'Handshake' },
  { id: 'coding', title: 'kitMind.coding.title', keywords: 'kitMind.coding.keywords', icon: 'Tag' },
];

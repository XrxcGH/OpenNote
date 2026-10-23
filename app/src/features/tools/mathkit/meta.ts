// The tools of the kit, in the order the window lists them. The registration file and the window both read this,
// so a tool is added here once.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';

export interface MathToolMeta {
  readonly id: string;
  readonly title: MessageKey;
  readonly keywords: MessageKey;
  readonly icon: IconName;
}

export const MATH_TOOLS: readonly MathToolMeta[] = [
  { id: 'series', title: 'kitMath.series.title', keywords: 'kitMath.series.keywords', icon: 'Atom' },
];

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
  { id: 'complex', title: 'kitMath.complex.title', keywords: 'kitMath.complex.keywords', icon: 'Atom' },
  { id: 'odes', title: 'kitMath.odes.title', keywords: 'kitMath.odes.keywords', icon: 'Atom' },
  { id: 'fourier', title: 'kitMath.fourier.title', keywords: 'kitMath.fourier.keywords', icon: 'Atom' },
  { id: 'numerics', title: 'kitMath.numerics.title', keywords: 'kitMath.numerics.keywords', icon: 'Atom' },
  { id: 'console', title: 'kitMath.console.title', keywords: 'kitMath.console.keywords', icon: 'Atom' },
];

// The tools of the dynamics and control kit, in the order the window lists them. The registration file and the
// window both read this, so a tool is added here once. It is plain data, because the command palette loads it at
// start-up.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';

export interface ControlToolMeta {
  readonly id: string;
  readonly title: MessageKey;
  /** The short name on the tool's tab. */
  readonly tab: MessageKey;
  readonly keywords: MessageKey;
  readonly icon: IconName;
}

export const CONTROL_TOOLS: readonly ControlToolMeta[] = [
  {
    id: 'markov',
    title: 'kitControl.markov.title',
    tab: 'kitControl.markov.tab',
    keywords: 'kitControl.markov.keywords',
    icon: 'FlowArrow',
  },
];

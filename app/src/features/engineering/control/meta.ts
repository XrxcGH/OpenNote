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

/** A tool's entry; its words are kitControl.<id>.title, .tab, and .keywords (the kit's test checks each exists). */
const tool = (id: string, icon: IconName): ControlToolMeta => ({
  id,
  title: `kitControl.${id}.title` as MessageKey,
  tab: `kitControl.${id}.tab` as MessageKey,
  keywords: `kitControl.${id}.keywords` as MessageKey,
  icon,
});

export const CONTROL_TOOLS: readonly ControlToolMeta[] = [
  tool('markov', 'FlowArrow'),
  tool('distributions', 'ChartBar'),
];

// The tools of the mechanisms and dynamics kit, in the order the window lists them, grouped by subject. The
// registration file and the window both read this, so a tool is added here once. It is plain data, because the
// command palette loads it at start-up.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';

export interface MechDynToolMeta {
  readonly id: string;
  readonly title: MessageKey;
  readonly keywords: MessageKey;
  readonly icon: IconName;
}

const tool = (id: string, icon: IconName): MechDynToolMeta => ({
  id,
  title: `kitMechDyn.${id}.title` as MessageKey,
  keywords: `kitMechDyn.${id}.keywords` as MessageKey,
  icon,
});

export const MECHDYN_TOOLS: readonly MechDynToolMeta[] = [tool('compliant', 'Spiral'), tool('sdof', 'Waveform')];

export const MECHDYN_TOOL_IDS: readonly string[] = MECHDYN_TOOLS.map((tool) => tool.id);

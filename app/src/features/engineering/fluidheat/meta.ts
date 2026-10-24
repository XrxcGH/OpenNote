// The tools of the fluid and heat transfer kit, in the order the window lists them. The registration file and the
// window both read this, so a tool is added here once. It is plain data, because the command palette loads it at
// start-up.
import type { MessageKey } from '../../../strings/t';
import type { IconName } from '../../../ui/icons';

export interface FluidHeatToolMeta {
  readonly id: string;
  readonly title: MessageKey;
  readonly keywords: MessageKey;
  readonly icon: IconName;
}

export const FLUIDHEAT_TOOLS: readonly FluidHeatToolMeta[] = [
  { id: 'statics', title: 'kitFluidHeat.statics.title', keywords: 'kitFluidHeat.statics.keywords', icon: 'Gauge' },
  { id: 'pipes', title: 'kitFluidHeat.pipes.title', keywords: 'kitFluidHeat.pipes.keywords', icon: 'Drop' },
  { id: 'dimensional', title: 'kitFluidHeat.dimensional.title', keywords: 'kitFluidHeat.dimensional.keywords', icon: 'Ruler' },
  { id: 'external', title: 'kitFluidHeat.external.title', keywords: 'kitFluidHeat.external.keywords', icon: 'Wind' },
  { id: 'viscous', title: 'kitFluidHeat.viscous.title', keywords: 'kitFluidHeat.viscous.keywords', icon: 'Waves' },
  { id: 'conduction', title: 'kitFluidHeat.conduction.title', keywords: 'kitFluidHeat.conduction.keywords', icon: 'Thermometer' },
  { id: 'fins', title: 'kitFluidHeat.fins.title', keywords: 'kitFluidHeat.fins.keywords', icon: 'Fan' },
  { id: 'transient', title: 'kitFluidHeat.transient.title', keywords: 'kitFluidHeat.transient.keywords', icon: 'Timer' },
  { id: 'convection', title: 'kitFluidHeat.convection.title', keywords: 'kitFluidHeat.convection.keywords', icon: 'ArrowsClockwise' },
];

export const FLUIDHEAT_TOOL_IDS: readonly string[] = FLUIDHEAT_TOOLS.map((tool) => tool.id);

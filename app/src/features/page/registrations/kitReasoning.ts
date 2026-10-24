// The reasoning kit's commands (flag kits.reasoning): one that opens the kit window, and one for each tool that opens
// the window at that tool's tab. Only these definitions load at start-up; the window loads on first use.
import type { ReasoningToolId } from '../../tools';
import type { IconName } from '../../../ui/icons';
import type { MessageKey } from '../../../strings/t';
import { addCommand } from './qolStudy';

const TOOLS: readonly (readonly [ReasoningToolId, IconName])[] = [
  ['digital', 'Circuitry'],
  ['games', 'ChartBar'],
];

async function open(tool?: ReasoningToolId): Promise<void> {
  (await import('../../tools')).openReasoningKit(tool);
}

addCommand({
  id: 'tools.kit-reasoning',
  title: 'kitReasoning.open',
  keywords: 'kitReasoning.keywords',
  category: 'general',
  icon: 'TreeStructure',
  flag: 'kits.reasoning',
  anywhere: true,
  bar: { group: 'study', priority: 32 },
  run: () => open(),
});

for (const [tool, icon] of TOOLS) {
  addCommand({
    id: `tools.kit-reasoning.${tool}`,
    title: `kitReasoning.tools.${tool}.open` as MessageKey,
    keywords: `kitReasoning.tools.${tool}.keywords` as MessageKey,
    category: 'general',
    icon,
    flag: 'kits.reasoning',
    anywhere: true,
    run: () => open(tool),
  });
}

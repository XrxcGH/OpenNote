// The signals and sound kit's registrations: a command and an Insert tab button that open the kit, and one palette
// command per tool, made in a loop from the kit's list, each opening the kit at that tool. This file loads at
// start-up, so it holds only definitions; the kit and its tools load when the window first opens.
import { startUp } from '../../../boot/startUp';
import { commandBar, commands } from '../../../registries';
import { SIGNAL_TOOLS, chooseSignalTool, restoreSignalInputs } from '../../tools/flags';

const openKit = async () => (await import('../../tools')).openTool('kit-signals');

commands.register({
  id: 'tools.kit-signals',
  title: 'kitSignals.kit.open',
  keywords: 'kitSignals.kit.keywords',
  category: 'general',
  icon: 'WaveSine',
  flag: 'kits.signals',
  when: () => true,
  run: openKit,
});
commandBar.register({
  id: 'tools.kit-signals',
  tab: 'insert',
  group: 'math',
  command: 'tools.kit-signals',
  flag: 'kits.signals',
  priority: 20,
});

// A live calculation block's Open in tool puts the tool's fields back, then opens the kit at that tool.
if (typeof window !== 'undefined') {
  // Best effort: a chunk that fails to load leaves Open in tool unavailable, and the commands still work.
  void startUp(import('../../tools'))
    .then((tools) =>
      tools.registerKit('signals', async (tool) => {
        if (restoreSignalInputs(tool, tools.takeKitInputs('signals', tool))) await openKit();
      }),
    )
    .catch(() => undefined);
}

for (const tool of SIGNAL_TOOLS) {
  commands.register({
    id: `tools.signals.${tool.id}`,
    title: tool.open,
    keywords: tool.keywords,
    category: 'general',
    icon: tool.icon,
    flag: 'kits.signals',
    when: () => true,
    run: async () => {
      chooseSignalTool(tool.id);
      await openKit();
    },
  });
}

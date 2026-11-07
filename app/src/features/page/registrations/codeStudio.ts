// The code studio's open command (flag code.studio). Owner: code:L04 (B12), which fills the window in.
// shared:x-shared registered it with the tool window entry, so every tool window has a command and the flag gates
// the window from the start. This file loads at start-up, so it holds only the definition.
import { addCommand } from './qolStudy';

addCommand({
  id: 'tools.code',
  title: 'codeStudio.studio.open',
  keywords: 'codeStudio.studio.keywords',
  category: 'code',
  icon: 'Terminal',
  flag: 'code.studio',
  anywhere: true,
  run: async () => (await import('../../tools')).openTool('code'),
});

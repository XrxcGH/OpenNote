// Test hooks for the layout audit (tests/ui/audit). Only `vite build --mode test` builds expose them. The audit
// lists every surface from the registries instead of a list kept by hand, so a new tool, command, or settings section
// is checked the day it is registered: window.__OPENNOTE_TEST__.auditRegistries() names them, and runCommand(id)
// opens one the way the palette does.
import { executeCommand } from '../commands/registry';
import type { CommandId } from '../commands/types';
import { navigate } from './location';
import type { Location } from './location';
// eslint-disable-next-line opennote/feature-boundaries -- test builds only: the audit lists the registry itself
import { slashItems } from '../features/page/registries';
// eslint-disable-next-line no-restricted-imports -- test builds only (main.tsx loads this file in test mode)
import { registerTestHook as platformHook } from '../platform/web/testHooks';
import { commandBar, commands, settingsSections, setupSteps, titleBarItems } from '../registries';
import { t } from '../strings/t';
import type { ToolId } from '../features/tools';

platformHook('auditRegistries', async () => ({
  tools: (await import('../features/tools')).TOOLS.map((tool) => tool.id),
  commands: commands.list().map((one) => ({
    id: one.id,
    title: t(one.title),
    palette: one.palette !== false,
    category: one.category,
  })),
  commandBar: commandBar.list().map((one) => ({ id: one.id, tab: one.tab, command: one.command })),
  settingsSections: settingsSections.list().map((one) => ({ id: one.id, title: t(one.title), order: one.order })),
  setupSteps: setupSteps.list().map((one) => ({ id: one.id, title: t(one.title), order: one.order })),
  titleBarItems: titleBarItems.list().map((one) => ({ id: one.id })),
  slashItems: slashItems.list().map((one) => ({ id: one.id, title: t(one.title), command: one.command })),
}));

// A command that opens a prompt settles only when the prompt is answered, so the hook does not wait for it.
platformHook('runCommand', (id: CommandId) => {
  void Promise.resolve(executeCommand(id)).catch(() => undefined);
});

platformHook('navigate', (location: Location) => navigate(location));

platformHook('openTool', async (id: ToolId) => (await import('../features/tools')).openTool(id));

platformHook('closeTools', async () => {
  const tools = await import('../features/tools');
  for (const tool of tools.TOOLS) tools.closeTool(tool.id);
});

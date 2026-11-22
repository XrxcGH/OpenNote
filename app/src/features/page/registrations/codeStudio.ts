// The code studio's start-up registrations (flag code.studio; owner code:L04). They are Open Code studio, New
// project, Open code block in Code studio, the studio's run keys, and Settings, then Code. The pop-out relay lets a
// studio in a window of its own edit a project block of this window's page. This file loads at start-up, so it
// holds only definitions; the studio window and its helpers load on first use.
import { isEnabled } from '../../../app/flags';
import { windowKind } from '../../../app/windowKind';
import { chord, defineCommand } from '../../../commands/registry';
import type { CommandDef, CommandId } from '../../../commands/types';
import { codeBlockAt } from '../../../editor/commands/code';
import { commands, settingsSections } from '../../../registries';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { targetEditor } from '../formattingBar/target';
import { PANEL_TYPES } from '../panels/kinds';
import { mountedPageHooks, shownMounted } from '../pagesApi';
import { addCommand } from './qolStudy';

const studio = async () => (await import('../../codestudio')).loadCodeStudioWindow();
const openStudio = async () => (await import('../../tools')).openTool('code');

addCommand({
  id: 'tools.code',
  title: 'codeStudio.studio.open',
  keywords: 'codeStudio.studio.keywords',
  category: 'code',
  icon: 'Terminal',
  flag: 'code.studio',
  anywhere: true,
  run: openStudio,
});

/** Puts a new project block on the shown page and opens the studio on it; with no page, a scratch project. */
async function openNewProject(data: Record<string, unknown>): Promise<void> {
  const loaded = await studio();
  const mounted = shownMounted.get();
  let block: string | null = null;
  if (mounted && mounted.page.readOnly === null) {
    const { insertPanelBlock } = await import('../panels/insertPanel');
    block = await insertPanelBlock(PANEL_TYPES.codeProject, data, loaded.fallbackOf(data));
  }
  if (block) {
    loaded.setStudioTarget({ block, run: false });
    announce(t('codeStudio.project.inserted'));
  } else if (!(await loaded.replaceScratchProject(data))) return;
  await openStudio();
}

commands.register(
  defineCommand<{ language?: string } | undefined>({
    id: 'code.newProject',
    title: 'codeStudio.studio.commands.newProject',
    keywords: 'codeStudio.studio.keywords',
    category: 'code',
    icon: 'FilePlus',
    flag: 'code.studio',
    // With no page shown, the project starts as a scratch project, so the command works anywhere.
    when: () => true,
    run: async (_ctx, args) => {
      const loaded = await studio();
      await openNewProject(loaded.newProjectData(loaded.projectLanguageOf(args?.language)));
    },
  }) as CommandDef<unknown>,
);

/** The page code block with the caret: its language and text. */
function codeBlockHere(): { language: string | null; text: string } | null {
  const editor = targetEditor();
  const at = editor && codeBlockAt(editor.state);
  return at ? { language: (at.node.attrs.language as string | null) ?? null, text: at.node.textContent } : null;
}

commands.register(
  defineCommand({
    id: 'code.openCodeBlock',
    title: 'codeStudio.studio.commands.openCodeBlock',
    keywords: 'codeStudio.studio.keywords',
    category: 'code',
    icon: 'Terminal',
    flag: 'code.studio',
    when: () => codeBlockHere() !== null,
    run: async () => {
      const block = codeBlockHere();
      if (!block) return;
      const loaded = await studio();
      const language = loaded.projectLanguageOf(block.language);
      await openNewProject(loaded.newProjectData(language, block.text));
    },
  }) as CommandDef<unknown>,
);

/** True while a code editor inside the studio window has focus, so code cells keep their own keys. */
const inStudio = () => document.activeElement?.closest('[data-code-studio]') != null;

const studioKey = (
  id: CommandId,
  keys: readonly string[],
  action: 'run' | 'stop' | 'restart' | 'problems',
  refines?: CommandId,
): CommandDef =>
  defineCommand({
    id,
    title: `codeStudio.studio.commands.${action}` as const,
    category: 'code',
    scope: 'codeEditor',
    keys: keys.map(chord),
    ...(refines ? { refines } : {}),
    allowInTextInput: true,
    palette: false,
    flag: 'code.studio',
    when: inStudio,
    run: async () => {
      const controller = (await studio()).activeStudio();
      if (!controller) return;
      if (action === 'run') controller.run();
      else if (action === 'stop') controller.stop();
      else if (action === 'restart') controller.restart();
      else controller.showPanel('problems');
    },
  });

// Ctrl+Enter and Ctrl+F5 run (DESIGN 5.3); in a code editor they win over the page's Ctrl+Enter.
commands.register(studioKey('code.run', ['Ctrl+Enter', 'Ctrl+F5'], 'run', 'block.toggleCheck'));
commands.register(studioKey('code.stop', ['Shift+F5'], 'stop', 'pages.presentPage'));
commands.register(studioKey('code.restart', ['Ctrl+Shift+F5'], 'restart'));
commands.register(studioKey('code.problems.show', ['Ctrl+Shift+M'], 'problems', 'para.outdent'));

settingsSections.register({
  id: 'code',
  title: 'codeStudio.studio.settings.title',
  icon: 'Code',
  order: 28,
  flag: 'code.studio',
  load: async () => ({ default: (await studio()).CodeSettingsSection }),
});

// A page view that starts to close tells the studio first, before it sends its last changes. So the text the studio
// still holds for a project block on it goes with them (features/codestudio/window/source.ts, PAGE_LEAVING_EVENT).
mountedPageHooks.register({
  id: 'code.studio.pageLeaving',
  attach: (mounted) => () => {
    window.dispatchEvent(new CustomEvent('opennote:codestudio-page-leaving', { detail: mounted }));
  },
});

// The pop-out relay: the main window answers a studio in a window of its own (features/codestudio/window/relay.ts).
// The studio's code loads with the first message, which is then handed to it again. A popped tool window never
// serves: it is the one that asks.
function installRelay(): void {
  if (typeof BroadcastChannel !== 'function' || windowKind() === 'tool') return;
  const channel = new BroadcastChannel('opennote.codestudio');
  let serving = false;
  channel.onmessage = (event) => {
    if (serving || !isEnabled('code.studio')) return;
    serving = true;
    channel.onmessage = null;
    void studio().then((loaded) => {
      loaded.serveRelay(channel, loaded.blockSource, (listener) => shownMounted.subscribe(listener));
      channel.dispatchEvent(new MessageEvent('message', { data: event.data }));
    });
  };
}
if (typeof window !== 'undefined') installRelay();

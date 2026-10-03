// @vitest-environment jsdom
// Spike S7's layout fixtures through the dispatcher, in a text box with Phase 4's commands registered. AltGr text
// wins over Ctrl+Alt shortcuts, and an exact key beats a physical key, in both shortcut sets.
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import '../registrations/editor';
import '../registrations/sync';
import { commandForKey } from '../../../commands/dispatcher';
import { LAYOUT_PRESSES } from '../../../commands/fixtures/layouts';
import { chord, defineCommand } from '../../../commands/registry';
import { commands } from '../../../registries';
import { DEFAULT_SETTINGS, settingsStore } from '../../../state/settings';
import { textPageFixture } from '../test/fixtures';
import { cleanupPages, renderPage } from '../test/harness';

let stop: (() => void) | null = null;

beforeAll(() => {
  // Phase 2's shell registers the shortcut list on Ctrl+/; these tests mount no shell.
  if (!commands.get('app.shortcuts')) {
    stop = commands.register(
      defineCommand({
        id: 'app.shortcuts',
        title: 'commands.app.shortcuts',
        category: 'help',
        keys: [chord('Ctrl+/')],
        allowInTextInput: true,
        run: () => {},
      }),
    );
  }
});
afterAll(() => stop?.());
afterEach(async () => {
  await cleanupPages();
  settingsStore.set({ settings: DEFAULT_SETTINGS, readOnly: false });
});

describe('keyboard layouts', () => {
  for (const press of LAYOUT_PRESSES) {
    it(`${press.layout}: ${press.pressed} ${press.expect ? `runs ${press.expect}` : 'types text'}`, async () => {
      if (press.preset)
        settingsStore.set({ settings: { ...DEFAULT_SETTINGS, keymap: { preset: press.preset } }, readOnly: false });
      const fixture = textPageFixture('- [ ] task');
      const block = fixture.page.blocks[0].id;
      const page = await renderPage({ fixture });
      const editor = page.mounted.pool.mount(block, { kind: 'selection', anchor: 7, head: 11 }, 'target')!;
      const altGraph = press.altGraph ?? false;
      const found = commandForKey({
        key: press.key,
        code: press.code,
        ctrlKey: (press.ctrl ?? false) || altGraph,
        altKey: (press.alt ?? false) || altGraph,
        shiftKey: press.shift ?? false,
        metaKey: false,
        isComposing: false,
        repeat: false,
        getModifierState: (name: string) => name === 'AltGraph' && altGraph,
        target: editor.view.dom,
      });
      expect(found?.id ?? null).toBe(press.expect);
    });
  }
});

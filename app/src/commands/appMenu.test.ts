// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { emitFakeShellEvent, resetFakeShell, setFakeShell } from '../platform/shellqol';
import { setHostSystem } from '../platform/system';
import type { Platform } from '../platform/types';
import { commands } from '../registries';
import type { NotesService } from '../services/notes/types';
import { initFlags } from '../app/flags';
import { resetStores } from '../state/store';
import { acceleratorFor, appMenuSpec, installAppMenu, KEY_ECHO_MS } from './appMenu';
import { chord, configureCommands, defineCommand } from './registry';
import type { CommandDef, CommandId } from './types';

const stops: (() => void)[] = [];

function add(id: string, rest: Partial<CommandDef<unknown>> = {}) {
  stops.push(
    commands.register(
      defineCommand<unknown>({
        id: id as CommandId,
        title: 'theme.commands.toggle',
        category: 'view',
        run() {},
        ...rest,
      }),
    ),
  );
}

beforeAll(() => configureCommands({ platform: { log() {} } as unknown as Platform, notes: {} as NotesService }));

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetStores();
  resetFakeShell();
  setHostSystem('windows');
  vi.useRealTimers();
});

describe('acceleratorFor', () => {
  it('reads Ctrl as Command and Alt as Option, in the form the shell parses', () => {
    expect(acceleratorFor(chord('Ctrl+Shift+D'))).toBe('Cmd+Shift+D');
    expect(acceleratorFor(chord('Ctrl+Alt+Up'))).toBe('Cmd+Alt+ArrowUp');
    expect(acceleratorFor(chord('Ctrl+,'))).toBe('Cmd+,');
    expect(acceleratorFor(chord('Ctrl+F11'))).toBe('Cmd+F11');
    expect(acceleratorFor(chord('Ctrl+PageDown'))).toBe('Cmd+PageDown');
  });

  it('gives no key equivalent to keys without Command or keys a menu cannot name', () => {
    expect(acceleratorFor(chord('F2'))).toBeNull();
    expect(acceleratorFor(chord('Alt+Shift+Up'))).toBeNull();
    expect(acceleratorFor(chord('Ctrl+?'))).toBeNull();
    expect(acceleratorFor(chord('Ctrl+Menu'))).toBeNull();
  });
});

describe('appMenuSpec', () => {
  it('puts Settings in the app menu and each category in its own menu, in order, sorted by title', () => {
    add('app.settings', { title: 'commands.app.settings', category: 'general', keys: [chord('Ctrl+,')] });
    add('test.zoom', { title: 'commands.app.palette', category: 'view' });
    add('test.dark', { category: 'view', keys: [chord('Ctrl+Shift+D')] });
    add('test.help', { category: 'help' });
    add('test.copy', { category: 'editing', keys: [chord('Ctrl+Alt+C')] });
    const spec = appMenuSpec();
    expect(spec.appItems).toEqual([{ id: 'app.settings', label: 'Open settings', accelerator: 'Cmd+,' }]);
    expect(spec.groups.map((group) => [group.category, group.title])).toEqual([
      ['editing', 'Editing'],
      ['view', 'View'],
      ['help', 'Help'],
    ]);
    expect(spec.groups[1]?.items).toEqual([
      { id: 'test.zoom', label: 'Open command palette', accelerator: null },
      { id: 'test.dark', label: 'Toggle dark mode', accelerator: 'Cmd+Shift+D' },
    ]);
  });

  it("leaves out hidden commands and commands whose flag is off, and leaves macOS's own keys alone", () => {
    add('test.copy', { keys: [chord('Ctrl+C')] });
    add('test.quit', { keys: [chord('Ctrl+Q')] });
    add('test.hidden', { palette: false });
    initFlags('dev', { 'page.heicImport': false });
    add('test.flagged', { flag: 'page.heicImport' });
    const items = appMenuSpec().groups.flatMap((group) => group.items);
    expect(items.map(({ id, accelerator }) => [id, accelerator])).toEqual([
      ['test.copy', null],
      ['test.quit', null],
    ]);
  });

  it('gives a shared key equivalent to the widest scope only, as the page runs it when nothing narrower applies', () => {
    add('test.link', { keys: [chord('Ctrl+K')], scope: 'editor', refines: 'test.palette' as CommandId });
    add('test.palette', { keys: [chord('Ctrl+K')] });
    const items = appMenuSpec().groups.flatMap((group) => group.items);
    expect(Object.fromEntries(items.map(({ id, accelerator }) => [id, accelerator]))).toEqual({
      'test.link': null,
      'test.palette': 'Cmd+K',
    });
  });

  it("follows the person's own keys", async () => {
    add('test.dark', { keys: [chord('Ctrl+Shift+D')] });
    const { settingsStore } = await import('../state/settings');
    const { settings } = settingsStore.get();
    settingsStore.set({ ...settingsStore.get(), settings: { ...settings, shortcuts: { 'test.dark': ['Ctrl+J'] } } });
    expect(appMenuSpec().groups[0]?.items[0]?.accelerator).toBe('Cmd+J');
  });
});

describe('installAppMenu', () => {
  function shell() {
    const sent: unknown[] = [];
    setFakeShell((name, args) => {
      if (name === 'menu.set') sent.push(args.spec);
      return { installed: true };
    });
    return sent;
  }

  it('does nothing off macOS', () => {
    const sent = shell();
    vi.useFakeTimers();
    stops.push(installAppMenu());
    vi.advanceTimersByTime(500);
    expect(sent).toEqual([]);
  });

  it('sends the menu on macOS once the commands settle, and again when they change', async () => {
    setHostSystem('macos');
    const sent = shell();
    vi.useFakeTimers();
    add('test.dark', { keys: [chord('Ctrl+Shift+D')] });
    stops.push(installAppMenu());
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toHaveLength(1);
    add('test.help', { category: 'help' });
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toHaveLength(2);
    expect((sent[1] as { groups: { category: string }[] }).groups.map((group) => group.category)).toEqual([
      'view',
      'help',
    ]);
  });

  it('runs a picked command, but not the echo of a key press the page already answered', async () => {
    setHostSystem('macos');
    shell();
    const run = vi.fn();
    add('test.dark', { keys: [chord('Ctrl+Shift+D')], run });
    add('test.help', { category: 'help', run });
    stops.push(installAppMenu());
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    emitFakeShellEvent({ kind: 'menu', command: 'test.dark' });
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    // Command+Shift+D on a Mac: the page heard it first, so the menu's copy of it is skipped.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'D', code: 'KeyD', metaKey: true, shiftKey: true }));
    emitFakeShellEvent({ kind: 'menu', command: 'test.dark' });
    await flush();
    expect(run).toHaveBeenCalledTimes(1);

    // A click on another item right after that key press still runs.
    emitFakeShellEvent({ kind: 'menu', command: 'test.help' });
    await flush();
    expect(run).toHaveBeenCalledTimes(2);
    expect(KEY_ECHO_MS).toBeLessThan(1000);
  });
});

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { commands, contextMenus } from '../registries';
import type { ContextMenuItem } from '../registries/types';
import { createMemoryNotesService } from '../services/notes/memory';
import { resetStores } from '../state/store';
import { createTestPlatform } from '../test/platform';
import { menuItemsFor } from './menus';
import { chord, commandContext, configureCommands, defineCommand } from './registry';
import type { CommandDef } from './types';

// Real features fill the tree and theme menus, so these tests use menus Phase 2 leaves empty.
const stops: (() => void)[] = [];

function add(id: string, rest: Partial<CommandDef<unknown>> = {}) {
  stops.push(
    commands.register(
      defineCommand<unknown>({
        id: `test.${id}`,
        title: 'theme.commands.toggle',
        category: 'general',
        run() {},
        ...rest,
      }),
    ),
  );
}

function item(id: string, rest: Partial<ContextMenuItem> = {}) {
  stops.push(
    contextMenus.register({ id, menu: 'page.table', command: `test.${id}`, group: 'edit', order: 0, ...rest }),
  );
}

beforeAll(() =>
  configureCommands({ platform: createTestPlatform(), notes: createMemoryNotesService({ seed: 'sample' }) }),
);

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetStores();
});

const ctx = () => commandContext('menu', { kind: 'node', id: 'p1' as never });

describe('menuItemsFor order and labels', () => {
  it('orders groups as registered, puts the danger group last, and separates groups', () => {
    for (const id of ['trash', 'rename', 'newPage', 'moveUp']) add(id);
    item('trash', { group: 'danger' });
    item('rename', { group: 'edit', order: 2 });
    item('newPage', { group: 'create' });
    item('moveUp', { group: 'edit', order: 1 });
    const specs = menuItemsFor('page.table', ctx());
    expect(specs.map((spec) => spec.id)).toEqual(['moveUp', 'rename', 'newPage', 'trash']);
    expect(specs.map((spec) => Boolean(spec.separatorBefore))).toEqual([false, false, true, true]);
    expect(specs.map((spec) => Boolean(spec.danger))).toEqual([false, false, false, true]);
  });

  it('labels items, adds shortcuts, and follows enablement and availability', () => {
    add('rename', { keys: [chord('F2')] });
    add('promote', { enabled: () => false });
    add('hidden', { when: () => false });
    add('flagged', { flag: 'install.uninstallEntry' });
    for (const id of ['rename', 'promote', 'hidden', 'flagged']) item(id);
    item('later', { flag: 'install.uninstallEntry' });
    const specs = menuItemsFor('page.table', ctx());
    expect(specs.map(({ id, label, shortcut, disabled }) => ({ id, label, shortcut, disabled }))).toEqual([
      { id: 'rename', label: 'Toggle dark mode', shortcut: 'F2', disabled: false },
      { id: 'promote', label: 'Toggle dark mode', shortcut: undefined, disabled: true },
    ]);
  });
});

describe('menuItemsFor states and actions', () => {
  it('makes checkbox items, and radio items when a whole group has a state', () => {
    add('light', { checked: () => true });
    add('dark', { checked: () => false });
    add('wrap', { checked: () => true });
    item('light', { menu: 'page.canvas', group: 'choice' });
    item('dark', { menu: 'page.canvas', group: 'choice', order: 1 });
    item('wrap', { menu: 'page.canvas', group: 'other' });
    const specs = menuItemsFor('page.canvas', ctx());
    expect(specs.map(({ kind, checked }) => ({ kind, checked }))).toEqual([
      { kind: 'radio', checked: true },
      { kind: 'radio', checked: false },
      { kind: 'checkbox', checked: true },
    ]);
  });

  it('runs the command with the item arguments and the target, and colors from the color submenu', async () => {
    const ran = vi.fn();
    add('move', { run: (context, args) => ran(args, context.target) });
    add('color', { run: (_, args) => ran(args) });
    item('move', { args: { direction: 'up' } });
    item('color', { submenu: 'color', args: { from: 'menu' } });
    const [move, color] = menuItemsFor('page.table', ctx());
    move.onSelect?.();
    await vi.waitFor(() => expect(ran).toHaveBeenCalledWith({ direction: 'up' }, { kind: 'node', id: 'p1' }));
    expect(color.onSelect).toBeUndefined();
    expect(color.submenu?.map((entry) => entry.label)).toEqual([
      'Ink',
      'Indigo',
      'Brick',
      'Fern',
      'Plum',
      'Amber',
      'Walnut',
      'No color',
    ]);
    color.submenu?.[3].onSelect?.();
    await vi.waitFor(() => expect(ran).toHaveBeenCalledWith({ from: 'menu', color: 'fern' }));
  });
});

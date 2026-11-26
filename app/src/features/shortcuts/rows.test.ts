// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { configureCommands, defineCommand } from '../../commands/registry';
import type { CommandCategory, CommandId } from '../../commands/types';
import type { Platform } from '../../platform/types';
import { commands } from '../../registries';
import type { NotesService } from '../../services/notes/types';
import { t } from '../../strings/t';
import { shortcutGroups } from './rows';

const stops: (() => void)[] = [];

function add(id: string, category: CommandCategory) {
  stops.push(
    commands.register(defineCommand({ id: id as CommandId, title: 'theme.commands.toggle', category, run() {} })),
  );
}

beforeAll(() => configureCommands({ platform: { log() {} } as unknown as Platform, notes: {} as NotesService }));
afterEach(() => stops.splice(0).forEach((stop) => stop()));

describe('the shortcut groups', () => {
  it('list the code editor commands in a Code editor group after Tables', () => {
    add('test.table', 'table');
    add('test.code', 'code');
    add('test.object', 'object');
    const groups = shortcutGroups('').filter((group) => group.rows.some((row) => row.id.startsWith('test.')));
    expect(groups.map((group) => group.category)).toEqual(['table', 'code', 'object']);
    const code = groups.find((group) => group.category === 'code')!;
    expect(t(code.title)).toBe('Code editor');
    expect(code.rows.map((row) => row.id)).toEqual(['test.code']);
  });
});

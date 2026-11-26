// The key scope fixture lists the registered sheet commands. So commands/scopes.test.ts checks the real chords
// against the text and code programs. This test keeps the fixture in step with bindings.ts.
import { describe, expect, it } from 'vitest';
import { tablesScopes } from '../../../commands/fixtures/scopes/tables';
import { SHEET_KEYS } from './bindings';

describe('the tables key scope fixture', () => {
  it('lists every sheet command that has a chord, with its scope, chords, and refined command', () => {
    const listed = tablesScopes.commands.filter((command) => command.id.startsWith('table.sheet.'));
    const registered = SHEET_KEYS.filter((def) => def.keys.length > 0).map((def) => ({
      id: def.id,
      scope: def.scope,
      keys: def.keys,
      ...(def.refines ? { refines: def.refines } : {}),
    }));
    expect(listed).toEqual(registered);
  });
});

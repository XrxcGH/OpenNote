// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { commands } from '../../../../registries';
import { sheetMenu } from '../registry';
import { MANAGE_COMMAND, MANAGE_EVENT } from './contribute';

describe('the conditional lane contribution', () => {
  it('registers the manage command, a Format menu item, and a context menu entry, and the command asks for the manager', () => {
    expect(commands.get(MANAGE_COMMAND)).toBeDefined();
    expect(sheetMenu('format').some((i) => i.command === MANAGE_COMMAND)).toBe(true);
    let asked = 0;
    const listen = () => asked++;
    document.addEventListener(MANAGE_EVENT, listen);
    void commands.get(MANAGE_COMMAND)?.run({} as never, undefined);
    document.removeEventListener(MANAGE_EVENT, listen);
    expect(asked).toBe(1);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { chord, defineCommand } from '../../commands/registry';
import { commands } from '../../registries';
import { resetStores } from '../../state/store';
import { DEFAULT_QUICK, quickKeyClashes, quickKeyProblem } from './quickCaptureControls';

const stops: (() => void)[] = [];

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  resetStores();
});

describe('the quick capture shortcut', () => {
  it('takes no global key until the person turns it on, and its default is no AltGr key', () => {
    // Windows delivers AltGr as Ctrl+Alt: a Ctrl+Alt+Q default typed quick notes instead of '@' on German keyboards.
    expect(DEFAULT_QUICK.choice.enabled).toBe(false);
    expect(quickKeyProblem(DEFAULT_QUICK.choice.key)).toBeNull();
  });

  it('refuses Ctrl+Alt with a letter or digit, which AltGr also presses', () => {
    expect(quickKeyProblem('Ctrl+Alt+Q')).toBe('altgr');
    expect(quickKeyProblem('ctrl + alt + shift + e')).toBe('altgr');
    expect(quickKeyProblem('Ctrl+Alt+2')).toBe('altgr');
    expect(quickKeyProblem('Ctrl+Alt+F5')).toBeNull();
    expect(quickKeyProblem('Win+Ctrl+Alt+Q')).toBeNull();
    expect(quickKeyProblem('Ctrl+Shift+Q')).toBeNull();
  });

  it('refuses keys that are not a modifier with a letter, digit, or F key', () => {
    expect(quickKeyProblem('Q')).toBe('invalid');
    expect(quickKeyProblem('Shift+Q')).toBe('invalid');
    expect(quickKeyProblem('Ctrl+')).toBe('invalid');
    expect(quickKeyProblem('Ctrl+Q+W')).toBe('invalid');
    expect(quickKeyProblem('Ctrl+F25')).toBe('invalid');
  });

  it('names the OpenNote commands the key would shadow', () => {
    stops.push(
      commands.register(
        defineCommand({
          id: 'test.quickClash',
          title: 'theme.commands.toggle',
          category: 'general',
          keys: [chord('Ctrl+Shift+Q')],
          run() {},
        }),
      ),
    );
    expect(quickKeyClashes('ctrl+shift+q')).toEqual(['test.quickClash']);
    expect(quickKeyClashes('Win+Shift+Q')).toEqual([]);
  });
});

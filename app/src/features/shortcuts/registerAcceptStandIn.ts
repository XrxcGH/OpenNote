import { chord, defineCommand } from '../../commands/registry';
import { commands } from '../../registries';

/** Stands in for the code editor's accept command, which refines Next tab on Ctrl+Tab. */
export const registerAccept = (): (() => void) =>
  commands.register(
    defineCommand({
      id: 'test.code.accept',
      title: 'commands.colors.ink',
      category: 'code',
      keys: [chord('Ctrl+Tab')],
      scope: 'codeEditor',
      refines: 'tabs.next',
      run() {},
    }),
  );

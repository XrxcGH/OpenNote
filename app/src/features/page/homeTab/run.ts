// Runs a catalog command with arguments on the target editor, then hands focus back to the text.
import { executeCommand } from '../../../commands/registry';
import type { CommandId } from '../../../commands/types';
import type { EditorCommandArgs } from '../../../editor/commands/catalog';
import { bumpBar } from '../../../shell/commandbar/barTick';
import { targetEditor } from '../formattingBar/target';

export function run(id: CommandId, args?: EditorCommandArgs): void {
  void executeCommand(id, args, 'commandBar').then(() => {
    targetEditor()?.commands.focus();
    bumpBar();
  });
}

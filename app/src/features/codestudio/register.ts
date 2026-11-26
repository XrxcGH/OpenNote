// The code studio's start-up registrations (ARCHITECTURE.md section 7.1). Only the code editor's commands load
// here; the editor itself (CodeMirror) and the studio window stay in lazy chunks.
import { registerCodeEditorCommands } from './editor/commands';
import { installCodeEditorTestHooks } from './editor/testHooks';

registerCodeEditorCommands();
installCodeEditorTestHooks();

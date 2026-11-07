// Repeat (owner: text:editor-commands; text DESIGN.md 4.1). F4 repeats the last formatting command with the same
// arguments. So does Ctrl+Y when there is nothing to redo. runEditorCommand notes each formatting command that
// applied. The command itself is kept, so a repeat runs exactly what ran before on the new selection.
import type { Command } from './command';

export interface Repeatable {
  id: string;
  command: Command;
}

/** Commands that are not formats to repeat: links, the painter's own steps, selection, speech, and repeat itself. */
const NOT_REPEATED: ReadonlySet<string> = new Set([
  'format.repeat',
  'format.link',
  'format.painter',
  'format.painterLocked',
  'format.copyFormat',
  'format.selectSimilar',
  'format.speak',
]);

/** Whether a command ID is a formatting command that Repeat can run again. */
export function isRepeatable(id: string): boolean {
  return (id.startsWith('format.') || id.startsWith('para.') || id.startsWith('list.')) && !NOT_REPEATED.has(id);
}

let last: Repeatable | null = null;

/** Notes a command that applied. Commands that are not formats are ignored. */
export function noteCommand(id: string, command: Command): void {
  if (isRepeatable(id)) last = { id, command };
}

/** The formatting command Repeat would run, or null. */
export function lastRepeatable(): Repeatable | null {
  return last;
}

/** Forgets the last command, for tests and when the window's page closes. */
export function forgetRepeatable(): void {
  last = null;
}

/** Runs the last formatting command again: false when there is none or it doesn't apply here. */
export function repeatLast(): Command {
  return (state, dispatch) => (last ? last.command(state, dispatch) : false);
}

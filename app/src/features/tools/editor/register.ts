// Adds the tools' page parts to every text editor: answers after the equals sign on math lines, and the date chips
// on checkbox and tagged lines. The page loads this once, shortly after start-up.
import { editorExtensions } from '../../../editor/extensions/kit';
import { dueChipsExtension } from './dueChipsExt';
import { notesExtension } from './notesExt';

let done = false;

export function registerToolsEditor(): void {
  if (done) return;
  done = true;
  editorExtensions.register({
    id: 'tools.notes',
    order: 80,
    flag: 'math.notes',
    kinds: ['text'],
    create: () => notesExtension(),
  });
  editorExtensions.register({
    id: 'tools.dueChips',
    order: 81,
    flag: 'tools.dueDates',
    kinds: ['text'],
    create: () => dueChipsExtension(),
  });
}

// What turning search by meaning, ask your notes, or writing tools on and off does, and the commands that open them.
// A command that finds its feature off asks first. Ask your notes reads pages through the index that search by
// meaning builds, so it turns that on too, and turning search by meaning off turns ask off and deletes the index.
import { commandContext } from '../../commands/registry';
import type { NotesService } from '../../services/notes/types';
import { hasImageText } from './background/imageText';
import { askToTurnOnExtra, isExtraOn, loadExtras, setExtra } from './extras';
import type { ExtraFeature } from './extras';
import { checkPageProtected, sweepProtectedPages, watchProtectedPages } from './protectedPages';

const meaning = () => import('./meaning/engine');

/** Turns a feature on or off from Settings, with what follows from it. Rejects when the choice can't be saved. */
export async function changeExtra(feature: ExtraFeature, on: boolean): Promise<void> {
  await loadExtras();
  if (feature === 'ask' && on) await setExtra('meaning', true);
  await setExtra(feature, on);
  if (feature !== 'writing' && on) void meaning().then((engine) => engine.startIndexing());
  if (feature === 'meaning' && !on) {
    if (isExtraOn('ask')) await setExtra('ask', false);
    await (await meaning()).forgetIndex();
  }
}

let watching: (() => void) | null = null;

function treeNotes(): NotesService | null {
  try {
    return commandContext('menu').notes;
  } catch {
    return null;
  }
}

/** Whether nothing of the page may be indexed or kept: a page of an encrypted section, or one the tree can't describe. */
export function pageIsProtected(id: string): Promise<boolean> {
  const notes = treeNotes();
  return notes ? checkPageProtected(id, notes) : Promise.resolve(true);
}

/**
 * At start-up: follows the tree for pages that become protected, drops what the device kept of protected pages, reads
 * the switches, and, when search by meaning is on, brings its index up to date in the background.
 */
export async function resumeExtras(): Promise<void> {
  await loadExtras();
  const notes = treeNotes();
  if (notes) {
    watching ??= watchProtectedPages(notes);
    if (isExtraOn('meaning') || (await hasImageText())) await sweepProtectedPages(notes).catch(() => undefined);
  }
  if (!isExtraOn('meaning')) return;
  const engine = await meaning();
  await engine.loadSavedIndex();
  await engine.startIndexing();
}

export async function openFindByMeaning(): Promise<void> {
  if (!(await askToTurnOnExtra('meaning'))) return;
  const { openFindByMeaning: open } = await import('./meaning/FindDialog');
  open();
}

export async function toggleRelatedPages(): Promise<void> {
  if (!(await askToTurnOnExtra('meaning'))) return;
  const { toggleRelatedPages: toggle } = await import('./meaning/RelatedPane');
  toggle();
}

export async function openAsk(): Promise<void> {
  if (!(await askToTurnOnExtra('ask'))) return;
  if (!isExtraOn('meaning')) await setExtra('meaning', true).catch(() => undefined);
  const { openAskDialog } = await import('./ask/AskDialog');
  openAskDialog();
}

// What turning search by meaning, ask your notes, or writing tools on and off does, and the commands that open them.
// A command that finds its feature off asks first. Ask your notes reads pages through the index that search by
// meaning builds, so it turns that on too, and turning search by meaning off turns ask off and deletes the index.
import { askToTurnOnExtra, isExtraOn, loadExtras, onExtraChange, setExtra } from './extras';
import { refreshModels } from './models/store';
import type { ExtraFeature } from './extras';

const meaning = () => import('./meaning/engine');

// Turning a feature on is when a language model or meaning model downloaded earlier should take over.
onExtraChange((_feature, on) => {
  if (on) void refreshModels().catch(() => undefined);
});

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

/** At start-up: reads the switches and, when search by meaning is on, brings its index up to date in the background. */
export async function resumeExtras(): Promise<void> {
  await loadExtras();
  // A language model or meaning model downloaded earlier takes over from the rules and the built-in embedder.
  if (isExtraOn('ask') || isExtraOn('writing') || isExtraOn('meaning')) await refreshModels();
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

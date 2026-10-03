// Spell check on the shown page (ARCHITECTURE.md section 16.3): at open, the textblocks in view are checked first and
// the rest in idle time, static and mounted alike. Textblocks that appear later outside editors, such as a block
// another window changed, are checked as they come; mounted editors report their own changes (spellingRanges).
import { isCheckable, spellingHighlights, TEXTBLOCK_SELECTOR } from '../../../editor/extensions/spellingText';
import { shownViewport } from '../viewport/viewport';
import { spellingEngine } from './current';
import type { SpellingEngine } from './engine';
import './spelling.module.css';

/** Reads textblocks, shows what the cache knows, and queues the rest: those in view first. */
function scan(elements: readonly Element[], engine: SpellingEngine, viewport: Element): void {
  const view = viewport.getBoundingClientRect();
  const inView: string[] = [];
  const rest: string[] = [];
  for (const element of elements) {
    if (!isCheckable(element)) continue;
    const text = spellingHighlights.refresh(element, engine, false);
    if (text === null) continue;
    const box = element.getBoundingClientRect();
    (box.bottom >= view.top && box.top <= view.bottom ? inView : rest).push(text);
  }
  engine.check(inView, 'now');
  engine.check(rest, 'idle');
}

// A text block's root has the ProseMirror class with or without an editor, for the same look. Only a mounted
// editor has `contenteditable`, and it reports its own changes; static text is checked here, also when it renders
// late or comes back after its editor is demoted.
const textblocksIn = (node: Node): Element[] => {
  if (!(node instanceof Element) || node.closest('.ProseMirror[contenteditable]')) return [];
  return node.matches(TEXTBLOCK_SELECTOR) ? [node] : [...node.querySelectorAll(TEXTBLOCK_SELECTOR)];
};

/** Checks the page in `world`. Returns the function that stops. */
export function attachSpelling(world: HTMLElement, viewport: HTMLElement, engine: SpellingEngine): () => void {
  const scanAll = () => scan([...world.querySelectorAll(TEXTBLOCK_SELECTOR)], engine, viewport);
  if (engine.active()) scanAll();
  let added: Element[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  const observer = new MutationObserver((records) => {
    for (const record of records) record.addedNodes.forEach((node) => added.push(...textblocksIn(node)));
    if (added.length) timer ??= setTimeout(flush, 100);
  });
  const flush = () => {
    timer = null;
    const elements = added.filter((element) => element.isConnected);
    added = [];
    if (engine.active()) scan(elements, engine, viewport);
  };
  observer.observe(world, { childList: true, subtree: true });
  const stop = engine.onChange((kind) => {
    if (kind === 'results') spellingHighlights.resolve(engine);
    else if (engine.active()) scanAll();
    else spellingHighlights.clear(world);
  });
  return () => {
    observer.disconnect();
    if (timer) clearTimeout(timer);
    stop();
    spellingHighlights.clear(world);
  };
}

/** Checks the page that is shown now, if any. */
export function attachShownPage(): () => void {
  const viewport = shownViewport.get();
  const engine = spellingEngine();
  if (!viewport || !engine) return () => undefined;
  return attachSpelling(viewport.world, viewport.viewport, engine);
}

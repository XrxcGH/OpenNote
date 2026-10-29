// The tools in the signals and sound kit: each one's id, its words in the strings, and its icon. The palette
// commands and the kit's tool list are both made from this list. Loads at start-up, so it holds no tool code.
import type { MessageKey } from '../../../strings/t';

export type SignalToolId = 'spectrum' | 'systems' | 'comms';

export interface SignalToolMeta {
  readonly id: SignalToolId;
  readonly title: MessageKey;
  readonly open: MessageKey;
  readonly keywords: MessageKey;
  readonly about: MessageKey;
  readonly icon: string;
}

const meta = (id: SignalToolId, icon: string): SignalToolMeta => ({
  id,
  title: `kitSignals.tools.${id}.title`,
  open: `kitSignals.tools.${id}.open`,
  keywords: `kitSignals.tools.${id}.keywords`,
  about: `kitSignals.tools.${id}.about`,
  icon,
});

export const SIGNAL_TOOLS: readonly SignalToolMeta[] = [
  meta('spectrum', 'WaveSine'),
  meta('systems', 'Sigma'),
  meta('comms', 'Binary'),
];

export const isSignalToolId = (value: unknown): value is SignalToolId => SIGNAL_TOOLS.some((tool) => tool.id === value);

/** Where the kit keeps the tool it last showed, so a palette command can open the window at a given tool. */
export const CHOSEN_KEY = 'opennote.kitSignals.tool';
/** Sent in the window when a command picks a tool while the kit is already open. */
export const CHOOSE_EVENT = 'opennote:kit-signals-choose';

/** Remembers the tool to show and tells an open kit to show it. */
export function chooseSignalTool(id: SignalToolId): void {
  try {
    window.localStorage.setItem(CHOSEN_KEY, id);
  } catch {
    // Storage can be off; the open kit still hears the event.
  }
  window.dispatchEvent(new CustomEvent(CHOOSE_EVENT, { detail: id }));
}

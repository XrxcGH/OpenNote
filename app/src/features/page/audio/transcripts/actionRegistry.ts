// The buttons other features add to a transcript's header, such as "Make cards" from the study tools. A feature
// registers an action once; the transcript draws a button for each, when the action's flag is on, and gives it the
// transcript's words and a name for where they came from.
import type { FlagId } from '../../../../app/flags';
import { createRegistry } from '../../../../registries/registry';
import type { MessageKey } from '../../../../strings/t';

/** What an action is given about the transcript it was pressed on. */
export interface TranscriptContext {
  /** One line of speech for each line of the transcript, in order. */
  text: string;
  /** A name for the source, such as the page's title. */
  source: string;
}

export interface TranscriptAction {
  id: string;
  label: MessageKey;
  flag?: FlagId;
  run(context: TranscriptContext): void | Promise<void>;
}

export const transcriptActions = createRegistry<TranscriptAction>('transcript action');

// The web platform's clipboard facts (owner after WP0: WP5). A browser can't read CF_HTML's source address or
// OneNote's formats, so tests set what the shell would report through the setClipboardFacts hook.
import type { ClipboardClient, ClipboardContent, ClipboardFacts } from '../types';
import { registerTestHook } from './testHooks';

const EMPTY: ClipboardContent = {
  sequence: 0,
  textSha256: null,
  sourceUrl: null,
  hasOneNote: false,
  wordImages: [],
  html: null,
  text: null,
  imageBmp: null,
};

export function createWebClipboard(): ClipboardClient {
  let content = EMPTY;
  registerTestHook('setClipboardFacts', (next: Partial<ClipboardContent>) => {
    content = { ...content, ...next, sequence: content.sequence + 1 };
  });
  return {
    facts: (): Promise<ClipboardFacts> => {
      const { html: _html, text: _text, imageBmp: _image, ...facts } = content;
      return Promise.resolve(facts);
    },
    read: () => Promise.resolve(content),
  };
}

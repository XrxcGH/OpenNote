// The clients for later phases (pages, spelling, the clipboard, images, and speech). The host side doesn't exist
// yet, so each call rejects with the code notImplemented, which callers already handle for a missing command.
// Phases 3 to 9 replace these with calls through `invoke` from ./invoke, so only platform/tauri imports Tauri.

import type { ClipboardClient, ImageClient, IpcError, PageService, SpeechClient, SpellingClient } from '../types';

function notImplemented(what: string): Promise<never> {
  const error: IpcError = { code: 'notImplemented', message: `${what} isn't implemented yet.` };
  return Promise.reject(error);
}

export const tauriPages: PageService = {
  load: () => notImplemented('pages.load'),
  save: () => notImplemented('pages.save'),
};

export const tauriSpelling: SpellingClient = {
  misspelled: () => notImplemented('spelling.misspelled'),
  suggest: () => notImplemented('spelling.suggest'),
  addToDictionary: () => notImplemented('spelling.addToDictionary'),
};

export const tauriClipboard: ClipboardClient = {
  readText: () => notImplemented('clipboard.readText'),
  writeText: () => notImplemented('clipboard.writeText'),
};

export const tauriImages: ImageClient = {
  add: () => notImplemented('images.add'),
  remove: () => notImplemented('images.remove'),
};

export const tauriSpeech: SpeechClient = {
  available: () => Promise.resolve(false),
  start: () => notImplemented('speech.start'),
};

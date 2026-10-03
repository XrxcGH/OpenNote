// Fakes for the clients of later phases, in memory, so the interface and its tests run in a plain browser. Each
// behaves as the real host would in the simplest way, and none of them leaves the page.

import type { ClipboardClient, ImageClient, PageService, SpeechClient, SpellingClient } from '../types';

export function createWebPages(): PageService {
  const pages = new Map<string, string>();
  return {
    load: (pageId) => Promise.resolve(pages.get(pageId) ?? null),
    save: (pageId, content) => {
      pages.set(pageId, content);
      return Promise.resolve();
    },
  };
}

/** Knows no dictionary, so it calls nothing misspelled, and offers no suggestions. */
export function createWebSpelling(): SpellingClient {
  const added = new Set<string>();
  return {
    misspelled: () => Promise.resolve([]),
    suggest: () => Promise.resolve([]),
    addToDictionary: (word) => {
      added.add(word);
      return Promise.resolve();
    },
  };
}

/** A clipboard of its own, so a test never touches the real one. */
export function createWebClipboard(): ClipboardClient {
  let text = '';
  return {
    readText: () => Promise.resolve(text),
    writeText: (next) => {
      text = next;
      return Promise.resolve();
    },
  };
}

/** Keeps images as object URLs for as long as the page lives. */
export function createWebImages(): ImageClient {
  const urls = new Map<string, string>();
  let next = 0;
  return {
    add: (image) => {
      const id = `image-${(next += 1)}`;
      const url = URL.createObjectURL(image);
      urls.set(id, url);
      return Promise.resolve({ id, url });
    },
    remove: (id) => {
      const url = urls.get(id);
      if (url) URL.revokeObjectURL(url);
      urls.delete(id);
      return Promise.resolve();
    },
  };
}

/** Dictation isn't available in a browser fake. */
export function createWebSpeech(): SpeechClient {
  return {
    available: () => Promise.resolve(false),
    start: () => Promise.resolve(() => undefined),
  };
}

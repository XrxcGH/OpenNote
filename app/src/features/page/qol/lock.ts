// Reading mode (FEATURES.md, Reading mode): a lock that makes the shown page read-only. The text and table editors
// read the lock through their extension, images and objects read the store, and the ink view honours the same
// store (readingLock). This module applies it to what is already mounted: every editor, the title, and the page's
// own marker, and it says so clearly. A page opens unlocked, and leaving the page lifts the lock.
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import type { MountedPage } from '../mount';
import { refreshEditable } from './editorExtension';
import { readingLock } from './stores';

export function toggleReadingLock(on?: boolean): void {
  readingLock.set(on ?? !readingLock.get());
}

export function attachLock(mounted: MountedPage): () => void {
  if (!mounted.host.flag('page.readingLock')) return () => undefined;
  const root = mounted.viewport.viewport;
  readingLock.set(false);
  const apply = () => {
    const locked = readingLock.get();
    root.toggleAttribute('data-reading-lock', locked);
    mounted.layer.blocks().forEach((block) => {
      const editor = mounted.pool.editor(block.id);
      if (editor) refreshEditable(editor);
    });
    // The title is plain text in the page's world; the page itself decides whether it can be edited at all.
    if (!mounted.page.readOnly) {
      mounted.title?.textbox.setAttribute('contenteditable', locked ? 'false' : 'plaintext-only');
    }
    announce(t(locked ? 'pageExtras.lock.on' : 'pageExtras.lock.off'));
  };
  const stop = readingLock.subscribe(apply);
  // An editor that mounts while the page is locked reads the store itself, but one that was demoted and mounted
  // again needs no help either: the extension is part of every editor.
  return () => {
    stop();
    root.removeAttribute('data-reading-lock');
    readingLock.set(false);
  };
}

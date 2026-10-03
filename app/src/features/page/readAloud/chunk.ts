// The read-aloud chunk (ARCHITECTURE.md section 19): the commands' work, the reader for the shown page, and its bar.
// Reading stops when the page changes.
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { commandContext } from '../../../commands/registry';
import { osStore } from '../../../state/os';
import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { shownPool } from '../pool/shown';
import { shownViewport } from '../viewport/viewport';
import { createWebSpeechEngine } from './engine';
import type { SpeechEngine } from './engine';
import { createReader } from './reader';
import type { Reader } from './reader';
import { ReadAloudBar } from './ReadAloudBar';
import { readingSequence, scopedSequence } from './sequence';
import styles from './readAloud.module.css';

let engine: SpeechEngine | null = null;
let reader: Reader | null = null;
let bar: { host: HTMLElement; root: Root } | null = null;
let stopWatching: (() => void) | null = null;

/** The selection or caret inside the active editor, if any. */
function editorRange(): Range | null {
  const active = shownPool.get()?.active();
  const selection = document.getSelection();
  if (!active || !selection?.rangeCount) return null;
  const range = selection.getRangeAt(0);
  return active.editor.view.dom.contains(range.startContainer) ? range : null;
}

function openSpeechSettings(): void {
  void commandContext('menu')
    .platform.shell.openExternal({ kind: 'windowsSettings', page: 'speech' })
    .catch(() => undefined);
}

function ensureReader(): Reader | null {
  engine ??= createWebSpeechEngine();
  if (!engine) return null;
  reader ??= createReader(engine, {
    speakOptions: () => {
      const { voice, rate } = getSettings().editing.readAloud;
      return { voice, rate };
    },
    reducedMotion: () => !osStore.get().animations,
    scroller: () => shownViewport.get()?.viewport ?? null,
  });
  stopWatching ??= shownViewport.subscribe(() => stopReadAloud());
  return reader;
}

function showBar(current: Reader): void {
  const viewport = shownViewport.get();
  const parent = viewport?.viewport.parentElement;
  if (!viewport || !parent || !engine) return;
  if (!bar || !bar.host.isConnected) {
    bar?.root.unmount();
    const host = document.createElement('div');
    host.className = styles.host;
    parent.insertBefore(host, viewport.viewport);
    bar = { host, root: createRoot(host) };
  }
  const voices = engine.voices.bind(engine);
  bar.root.render(
    createElement(ReadAloudBar, {
      reader: current,
      voices,
      onRestart: () => startReading(),
      onStop: () => stopReadAloud(),
      onOpenSpeechSettings: openSpeechSettings,
    }),
  );
}

/** Reads the selection, else from the caret to the end, else the whole page. */
export function startReading(): void {
  const current = ensureReader();
  const viewport = shownViewport.get();
  if (!current || !viewport) {
    announce(t('readAloud.unavailable'));
    return;
  }
  const range = editorRange();
  const items = readingSequence(viewport.world, { readCode: getSettings().editing.readAloud.readCode });
  showBar(current);
  current.start(scopedSequence(items, range));
}

/** Ctrl+Shift+U: starts, pauses, and resumes. */
export function toggleReadAloud(): void {
  if (!reader || reader.state.get().status === 'idle') startReading();
  else reader.toggle();
}

export function nextParagraph(): void {
  reader?.next();
}

export function previousParagraph(): void {
  reader?.previous();
}

export function stopReadAloud(): void {
  const hadFocus = bar?.host.contains(document.activeElement) ?? false;
  reader?.stop();
  bar?.root.unmount();
  bar?.host.remove();
  bar = null;
  if (hadFocus) shownPool.get()?.active()?.editor.view.focus();
}

/** Whether reading is on, for the commands' availability. */
export function isReading(): boolean {
  return reader !== null && reader.state.get().status !== 'idle';
}

/** Tests choose the engine, and start over. */
export function resetReadAloud(next: SpeechEngine | null = null): void {
  stopReadAloud();
  stopWatching?.();
  stopWatching = null;
  reader = null;
  engine = next;
}

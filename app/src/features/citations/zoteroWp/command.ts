// The Zotero commands on the page that is open (Citation helper): Add or edit citation, bibliography, Refresh, Unlink,
// and document settings. Zotero shows its own windows; the text block that has the caret takes the changes.
import type { Editor } from '@tiptap/core';
import { getLocation } from '../../../app/location';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { SHARED, setZoteroPrefs, zoteroPrefs } from '../store';
import type { Host } from './bridge';
import { runZotero, tauriTransport } from './run';
import type { RunResult, Transport, ZoteroCommand } from './run';

export const ZOTERO_COMMANDS: readonly ZoteroCommand[] = [
  'addEditCitation',
  'addEditBibliography',
  'refresh',
  'removeCodes',
  'setDocPrefs',
];

/** Zotero's questions, answered by the person: a message is shown, and a choice is asked for. */
async function ask(text: string, _icon: number, buttons: number): Promise<number> {
  if (buttons === 0) {
    showToast({ message: text });
    return 1;
  }
  const yes = window.confirm(text);
  return buttons === 3 ? (yes ? 2 : 1) : yes ? 1 : 0;
}

export function editorHost(editor: Editor): Host {
  return {
    state: () => editor.state,
    dispatch: (transaction) => editor.view.dispatch(transaction),
    alert: ask,
    activate: () => editor.commands.focus(),
  };
}

function notebookKey(): string {
  const location = getLocation();
  return location.view === 'workspace' && location.notebookId ? String(location.notebookId) : SHARED;
}

const MESSAGES = {
  done: 'study.citations.zotero.done',
  cancelled: 'study.citations.zotero.cancelled',
  missing: 'study.citations.zotero.missing',
  failed: 'study.citations.zotero.failed',
} as const;

/** Runs a Zotero command on `editor`, says how it went, and returns the result. */
export async function zoteroCommand(command: ZoteroCommand, editor: Editor, transport?: Transport): Promise<RunResult> {
  const notebook = notebookKey();
  const prefs = { get: () => zoteroPrefs(notebook), set: (data: string) => setZoteroPrefs(notebook, data) };
  let result: RunResult;
  if (typeof window === 'undefined' || (!transport && !('__TAURI_INTERNALS__' in window))) {
    result = { status: 'missing' };
  } else {
    result = await runZotero(command, editorHost(editor), prefs, transport ?? (await tauriTransport()));
  }
  const text =
    result.status === 'done' && result.errors > 0
      ? t('study.citations.zotero.someFailed', { count: result.errors })
      : t(MESSAGES[result.status]);
  announce(text);
  if (result.status !== 'done')
    showToast({ message: text, tone: result.status === 'cancelled' ? 'neutral' : 'danger' });
  return result;
}

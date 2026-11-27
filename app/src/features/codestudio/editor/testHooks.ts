// Test hooks for the code editor's behavior specs. Only `vite build --mode test` builds have them.
// window.__OPENNOTE_TEST__.codeEditorMount mounts an editor on top of the app. Its `suggest` option gives it a fake
// suggestion source that completes a fixed prefix. codeEditorText and codeEditorHead read its text and caret.
// codeEditorProblem puts one problem on it. codeEditorSuggest('show') asks the source for a suggestion and shows it,
// and codeEditorSuggest('accept') inserts what shows, with the same announcements as the keys. The NVDA run calls it
// from a real key, because NVDA does not speak a live region that changes while someone types.
import type { CodeEditor } from './create';

interface MountOptions {
  language: string;
  text: string;
  /** The source suggests `then` whenever the text before the caret ends with `when`. */
  suggest?: { when: string; then: string };
}

export function installCodeEditorTestHooks(): void {
  if (import.meta.env.MODE !== 'test' || typeof window === 'undefined') return;
  const hooks = (window.__OPENNOTE_TEST__ ??= {});
  let unmount: (() => void) | null = null;
  let current: CodeEditor | null = null;
  hooks.codeEditorMount = async (options: MountOptions) => {
    unmount?.();
    const { createCodeEditor } = await import('./index');
    const host = document.createElement('div');
    host.dataset.testid = 'code-editor-host';
    Object.assign(host.style, {
      position: 'fixed',
      right: '16px',
      bottom: '16px',
      width: '520px',
      height: '260px',
      zIndex: 'var(--layer-overlay)',
    });
    document.body.append(host);
    const editor = createCodeEditor(host, { language: options.language as never, text: options.text });
    const suggest = options.suggest;
    if (suggest) {
      editor.setSuggestionSource(({ text, pos }) =>
        text.slice(0, pos).endsWith(suggest.when)
          ? { from: pos, text: suggest.then, origin: 'pattern', confidence: 1 }
          : null,
      );
    }
    await editor.ready;
    current = editor;
    unmount = () => {
      current = null;
      editor.destroy();
      host.remove();
    };
    return true;
  };
  // Shows one problem on the first `length` characters from `from`, as the studio's checks would.
  hooks.codeEditorProblem = (from: number, length: number, message: string) => {
    current?.showProblems([
      { file: 'main', from, to: from + length, severity: 'error', code: 'test', message, source: 'test' },
    ]);
    return current !== null;
  };
  hooks.codeEditorSuggest = (mode: 'show' | 'accept') => {
    if (!current) return false;
    if (mode === 'show') {
      void current.requestSuggestion(false);
      return true;
    }
    return current.acceptSuggestion('all') !== null;
  };
  hooks.codeEditorText = () => current?.getText() ?? null;
  hooks.codeEditorHead = () => current?.view.state.selection.main.head ?? null;
}

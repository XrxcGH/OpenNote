// Test hooks for the code editor's behavior specs. Only `vite build --mode test` builds have them:
// window.__OPENNOTE_TEST__.codeEditorMount mounts an editor on top of the app (the studio window comes in B12), and
// codeEditorSuggest gives it a fake suggestion source that completes a fixed prefix.

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
      zIndex: '50',
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
    unmount = () => {
      editor.destroy();
      host.remove();
    };
    return true;
  };
  hooks.codeEditorText = () =>
    document.querySelector('[data-testid="code-editor-host"] .cm-content')?.textContent ?? null;
}

// The link popover (ARCHITECTURE.md section 22.6; owner: WP4): Ctrl+K, the Insert tab, or "Edit link" opens it
// next to the selection. It edits the address and, at a bare caret or on an existing link, the words shown. Save
// and Enter apply it as one command; Remove takes the link off and keeps the words; Escape closes it.
import type { Editor } from '@tiptap/core';
import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import { runEditorCommand } from '../../../editor/commands/catalog';
import { linkAt, normalizeHref } from '../../../editor/commands/links';
import { isBlockedHref } from '../../../editor/schema/constants';
import { t } from '../../../strings/t';
import { Button, Popover, TextField } from '../../../ui';
import styles from './LinkPopover.module.css';

export interface LinkPopoverProps {
  editor: Editor;
  anchor: HTMLElement;
  onClose(): void;
  /** Ends holding the keys typed while the popover loaded, and returns them for the address field. */
  typed?: () => string;
}

/** What the address field says is wrong, or undefined when it can be saved. */
export function linkProblem(href: string): string | undefined {
  if (href.trim() === '') return undefined;
  if (isBlockedHref(href.trim())) return t('editor.link.blocked');
  return normalizeHref(href) ? undefined : t('editor.link.invalid');
}

/** The popover's fields and actions: Save applies the link as one command, Remove takes it off. */
function useLinkForm(editor: Editor, onClose: () => void) {
  const existing = linkAt(editor.state);
  const [href, setHref] = useState(existing?.href ?? '');
  const [text, setText] = useState(existing?.text ?? '');
  const [tried, setTried] = useState(false);
  const showsText = editor.state.selection.empty || existing !== null;
  const problem = linkProblem(href);
  const save = () => {
    setTried(true);
    if (href.trim() === '' || problem) return;
    runEditorCommand(editor, 'format.link', { href, text: showsText ? text : undefined });
    onClose();
  };
  const remove = () => {
    runEditorCommand(editor, 'format.link', { href: '' });
    onClose();
  };
  const error = tried || problem === t('editor.link.blocked') ? problem : undefined;
  return { existing, href, setHref, text, setText, showsText, error, save, remove };
}

export function LinkPopover({ editor, anchor, onClose, typed }: LinkPopoverProps) {
  const { existing, href, setHref, text, setText, showsText, error, save, remove } = useLinkForm(editor, onClose);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  const form = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const field = form.current?.querySelector('input');
    field?.focus();
    const early = typed?.();
    if (field && early) {
      // Into the field at once, so keys that arrive before React renders again follow these.
      field.value += early;
      setHref(field.value);
    }
  }, [typed, setHref]);

  return (
    <Popover anchor={anchorRef} label={t('editor.link.dialog')} open onClose={onClose}>
      <form
        ref={form}
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <TextField
          label={t('editor.link.address')}
          value={href}
          onChange={setHref}
          error={error}
          autoSelect
          onCommit={save}
          onCancel={onClose}
        />
        {showsText ? (
          <TextField label={t('editor.link.text')} value={text} onChange={setText} onCommit={save} onCancel={onClose} />
        ) : null}
        <div className={styles.actions}>
          {existing ? (
            <Button variant="quiet" onClick={remove}>
              {t('editor.link.remove')}
            </Button>
          ) : null}
          <Button variant="primary" type="submit">
            {t('editor.link.save')}
          </Button>
        </div>
      </form>
    </Popover>
  );
}

/** A fixed, invisible box over the selection for the popover to anchor to. */
function selectionAnchor(editor: Editor): HTMLElement {
  const box = document.body.appendChild(document.createElement('span'));
  box.className = styles.anchor;
  const { from, to } = editor.state.selection;
  try {
    const start = editor.view.coordsAtPos(from);
    const end = editor.view.coordsAtPos(to);
    box.style.insetInlineStart = `${Math.min(start.left, end.left)}px`;
    box.style.insetBlockStart = `${start.top}px`;
    box.style.inlineSize = `${Math.max(1, Math.abs(end.right - start.left))}px`;
    box.style.blockSize = `${Math.max(1, end.bottom - start.top)}px`;
  } catch {
    box.style.insetInlineStart = '50%';
    box.style.insetBlockStart = '30%';
  }
  return box;
}

/** Opens the popover over the editor's selection. Resolves when it closes; focus goes back to the text. */
export function openLinkPopover(editor: Editor, typed?: () => string): Promise<void> {
  const anchor = selectionAnchor(editor);
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        anchor.remove();
        if (!editor.isDestroyed) editor.commands.focus(undefined, { scrollIntoView: false });
        resolve();
      });
    };
    // Mounted before this returns, so the keys held while the chunk loaded reach the field before any more arrive.
    flushSync(() => root.render(<LinkPopover editor={editor} anchor={anchor} onClose={close} typed={typed} />));
  });
}

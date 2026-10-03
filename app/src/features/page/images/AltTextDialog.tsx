// The "Alt text" dialog (Phase 4 ARCHITECTURE.md section 20.2): a multi-line description of up to 2,000
// characters and a "Decorative" checkbox that disables it. Save sends one patchBlock. Phase 5's drawing dialog
// uses the same component.
import { useId, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../strings/t';
import { Dialog } from '../../../ui';
import type { DialogAction } from '../../../ui';
import type { ImageHandle } from '../blocks/imageBlock';
import styles from './dialog.module.css';

export const MAX_ALT_LENGTH = 2000;

export interface AltTextValue {
  alt: string;
  decorative: boolean;
}

export interface AltTextDialogProps {
  initial: AltTextValue;
  onSave(value: AltTextValue): void;
  onCancel(): void;
  returnFocus?: () => HTMLElement | null;
}

export function AltTextDialog({ initial, onSave, onCancel, returnFocus }: AltTextDialogProps) {
  const [alt, setAlt] = useState(initial.alt);
  const [decorative, setDecorative] = useState(initial.decorative);
  const field = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const save = () => onSave({ alt: alt.trim(), decorative });
  const actions: DialogAction[] = [
    { id: 'cancel', label: t('common.cancel'), variant: 'secondary', leastDestructive: true, onPress: onCancel },
    { id: 'save', label: t('images.altDialog.save'), variant: 'primary', onPress: save },
  ];
  return (
    <Dialog
      title={t('images.altDialog.title')}
      description={t('images.altDialog.description')}
      actions={actions}
      initialFocus={decorative ? 'first' : field}
      onDismiss={onCancel}
      returnFocus={returnFocus}
    >
      <div className={styles.field}>
        <label className={styles.label} htmlFor={`${id}-alt`}>
          {t('images.altDialog.field')}
        </label>
        <textarea
          ref={field}
          id={`${id}-alt`}
          className={styles.textarea}
          value={alt}
          rows={4}
          maxLength={MAX_ALT_LENGTH}
          disabled={decorative}
          aria-describedby={`${id}-count`}
          onChange={(event) => setAlt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.ctrlKey) {
              event.preventDefault();
              save();
            }
          }}
        />
        <span id={`${id}-count`} className={styles.help}>
          {t('images.altDialog.count', { count: alt.length.toLocaleString() })}
        </span>
      </div>
      <label className={styles.check}>
        <input type="checkbox" checked={decorative} onChange={(event) => setDecorative(event.target.checked)} />
        {t('images.altDialog.decorative')}
      </label>
    </Dialog>
  );
}

/** Asks for an image's description and sends it, as one undo step. Resolves whether anything changed. */
export function editAltText(handle: ImageHandle): Promise<boolean> {
  const block = handle.block();
  const initial: AltTextValue = {
    alt: typeof block.data.alt === 'string' ? block.data.alt : '',
    decorative: block.data.decorative === true,
  };
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  return new Promise((resolve) => {
    const close = () =>
      queueMicrotask(() => {
        root.unmount();
        host.remove();
      });
    const onSave = (value: AltTextValue) => {
      close();
      if (value.alt === initial.alt && value.decorative === initial.decorative) return resolve(false);
      void handle.ctx.sync
        .send({
          edits: [{ edit: 'patchBlock', block: block.id, data: { alt: value.alt, decorative: value.decorative } }],
        })
        .then(
          () => resolve(true),
          () => resolve(false),
        );
    };
    const onCancel = () => {
      close();
      resolve(false);
    };
    root.render(
      <AltTextDialog initial={initial} onSave={onSave} onCancel={onCancel} returnFocus={() => handle.element} />,
    );
  });
}

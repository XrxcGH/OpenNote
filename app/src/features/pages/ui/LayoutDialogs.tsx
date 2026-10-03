// The layout dialogs: the line spacing field, and the list of saved layout templates with save, use, share, and import.
import { useState } from 'react';
import type { Platform } from '../../../platform/types';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, Dialog, Switch, TextField, showToast } from '../../../ui';
import {
  LAYOUT_EXTENSION,
  MAX_LAYOUTS,
  layoutName,
  mmToUnits,
  readLayoutFile,
  spacingRangeMm,
  unitsToMm,
  writeLayoutFile,
} from '../layout';
import type { LayoutTemplate } from '../layout';
import { fileSafe, pickTextFile, saveFile } from '../host/files';
import { savedLayouts } from '../live/layoutStore';
import styles from './pagesUi.module.css';

export interface SpacingDialogProps {
  readonly pattern: string;
  readonly spacing: number;
  apply(units: number): void;
  close(): void;
}

/** A spacing field in millimeters for ruled, grid, dot, and isometric paper. */
export function SpacingDialog({ pattern, spacing, apply, close }: SpacingDialogProps) {
  const range = spacingRangeMm(pattern);
  const [text, setText] = useState(String(unitsToMm(spacing)));
  const value = Number(text.replace(',', '.'));
  const valid =
    range !== null && text.trim() !== '' && Number.isFinite(value) && value >= range[0] && value <= range[1];
  const commit = () => {
    if (!valid) return;
    apply(mmToUnits(value));
    close();
  };
  const [lo, hi] = range ?? [0, 0];
  const actions = [
    { id: 'cancel', label: t('pagesPlus.layouts.spacing.cancel'), variant: 'secondary' as const, onPress: close },
    ...(range
      ? [{ id: 'apply', label: t('pagesPlus.layouts.spacing.apply'), variant: 'primary' as const, onPress: commit }]
      : []),
  ];
  return (
    <Dialog
      title={t('pagesPlus.layouts.spacing.title')}
      description={range ? t('pagesPlus.layouts.spacing.description') : t('pagesPlus.layouts.spacing.none')}
      size="small"
      onDismiss={close}
      actions={actions}
    >
      {range ? (
        <TextField
          label={t('pagesPlus.layouts.spacing.field')}
          value={text}
          onChange={setText}
          help={t('pagesPlus.layouts.spacing.help', { min: lo, max: hi })}
          error={text !== '' && !valid ? t('pagesPlus.layouts.spacing.invalid', { min: lo, max: hi }) : undefined}
          onCommit={commit}
          autoSelect
        />
      ) : null}
    </Dialog>
  );
}

export interface TemplatesDialogProps {
  readonly platform: Platform;
  save(list: readonly LayoutTemplate[]): boolean;
  /** Puts a saved layout on the page. */
  use(layout: LayoutTemplate): void;
  make(name: string, withPaper: boolean): LayoutTemplate;
  adopt(layout: Omit<LayoutTemplate, 'id'>): LayoutTemplate | null;
  close(): void;
}

async function shareFile(platform: Platform, layout: LayoutTemplate): Promise<void> {
  await saveFile(platform, {
    suggested: `${fileSafe(layout.name, 'layout')}${LAYOUT_EXTENSION}`,
    label: t('pagesPlus.layouts.templates.fileLabel'),
    extension: LAYOUT_EXTENSION.slice(1),
    bytes: new TextEncoder().encode(writeLayoutFile(layout)),
  });
}

const allLayouts = (value: readonly LayoutTemplate[]) => value;

export function TemplatesDialog(props: TemplatesDialogProps) {
  const { platform, save, use, make, adopt, close } = props;
  const list = useStore(savedLayouts, allLayouts);
  const [name, setName] = useState('');
  const [withPaper, setWithPaper] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const create = () => {
    const clean = layoutName(name);
    if (!clean) return setMessage(t('pagesPlus.layouts.templates.badName'));
    if (list.length >= MAX_LAYOUTS) return setMessage(t('pagesPlus.layouts.templates.full', { max: MAX_LAYOUTS }));
    if (!save([...list, make(clean, withPaper)])) return setMessage(t('pagesPlus.layouts.templates.failed'));
    setName('');
    setMessage(null);
    showToast({ message: t('pagesPlus.layouts.templates.saved', { name: clean }) });
  };
  const importFile = async () => {
    const text = await pickTextFile(`${LAYOUT_EXTENSION},application/json`);
    if (text === null) return;
    const read = readLayoutFile(text);
    if (!read.ok) return setMessage(t(`pagesPlus.layouts.templates.${read.error}`));
    const added = adopt(read.layout);
    if (!added) return setMessage(t('pagesPlus.layouts.templates.full', { max: MAX_LAYOUTS }));
    setMessage(null);
    showToast({ message: t('pagesPlus.layouts.templates.importDone', { name: added.name }) });
  };
  return (
    <Dialog
      title={t('pagesPlus.layouts.templates.title')}
      description={t('pagesPlus.layouts.templates.description')}
      size="medium"
      onDismiss={close}
      actions={[{ id: 'close', label: t('pagesPlus.layouts.templates.close'), variant: 'primary', onPress: close }]}
    >
      <div className={styles.form}>
        <TextField
          label={t('pagesPlus.layouts.templates.name')}
          value={name}
          onChange={setName}
          error={message ?? undefined}
          onCommit={create}
        />
        <Switch label={t('pagesPlus.layouts.templates.withPaper')} checked={withPaper} onChange={setWithPaper} />
        <div className={styles.buttons}>
          <Button variant="primary" onClick={create}>
            {t('pagesPlus.layouts.templates.save')}
          </Button>
          <Button variant="secondary" onClick={() => void importFile()}>
            {t('pagesPlus.layouts.templates.import')}
          </Button>
        </div>
        {list.length === 0 ? (
          <p className={styles.hint}>{t('pagesPlus.layouts.templates.empty')}</p>
        ) : (
          <ul className={styles.items}>
            {list.map((layout) => (
              <li key={layout.id} className={styles.item}>
                <span className={styles.itemName}>{layout.name}</span>
                <Button
                  variant="quiet"
                  aria-label={t('pagesPlus.layouts.templates.useLabel', { name: layout.name })}
                  onClick={() => use(layout)}
                >
                  {t('pagesPlus.layouts.templates.use')}
                </Button>
                <Button
                  variant="quiet"
                  aria-label={t('pagesPlus.layouts.templates.shareLabel', { name: layout.name })}
                  onClick={() =>
                    void shareFile(platform, layout).catch(() => setMessage(t('pagesPlus.layouts.templates.failed')))
                  }
                >
                  {t('pagesPlus.layouts.templates.share')}
                </Button>
                <Button
                  variant="quiet"
                  aria-label={t('pagesPlus.layouts.templates.removeLabel', { name: layout.name })}
                  onClick={() => {
                    save(list.filter((item) => item.id !== layout.id));
                    showToast({ message: t('pagesPlus.layouts.templates.deleted', { name: layout.name }) });
                  }}
                >
                  {t('pagesPlus.layouts.templates.remove')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Dialog>
  );
}

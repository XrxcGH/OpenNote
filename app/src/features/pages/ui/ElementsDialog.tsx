// The elements library, and the dialog that saves the picked items into it. The library is a dialog with a search box,
// folders, and a card for each element with Insert, Rename, Share, and Delete.
import { useMemo, useState } from 'react';
import type { Platform } from '../../../platform/types';
import { useStore } from '../../../state/store';
import { t } from '../../../strings/t';
import { Button, Dialog, TextField, showToast } from '../../../ui';
import {
  ELEMENT_EXTENSION,
  allFolders,
  cleanName,
  createFolder,
  listFolder,
  readElementFile,
  removeElement,
  removeFolder,
  renameElement,
  addElement,
  searchElements,
  writeElementFile,
} from '../elements';
import type { ElementEntry, ElementLibrary, LibraryError, LibraryResult } from '../elements';
import { insertEntry, thumbnail } from '../host/elementActions';
import { changeLibrary, elementLibrary } from '../host/elementStore';
import type { ElementFileError } from '../elements';
import { fileSafe, pickTextFile, saveFile } from '../host/files';
import styles from './pagesUi.module.css';

const errorText = (error: LibraryError | ElementFileError | 'notSaved' | 'nothing') =>
  t(`pagesPlus.elements.errors.${error}`);

export interface SaveElementProps {
  readonly defaultName: string;
  save(name: string, folder: string): Promise<string | null>;
  close(): void;
}

/** Asks for the name and folder of a new element. `save` answers an error to show, or null when it worked. */
export function SaveElementDialog({ defaultName, save, close }: SaveElementProps) {
  const [name, setName] = useState(defaultName);
  const [folder, setFolder] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    if (cleanName(name) === null) return setError(t('pagesPlus.elements.save.badName'));
    setBusy(true);
    const failed = await save(name, folder.trim().replace(/^\/+|\/+$/g, ''));
    setBusy(false);
    if (failed) setError(failed);
    else close();
  };
  return (
    <Dialog
      title={t('pagesPlus.elements.save.title')}
      description={t('pagesPlus.elements.save.description')}
      size="small"
      onDismiss={close}
      actions={[
        { id: 'cancel', label: t('pagesPlus.elements.save.cancel'), variant: 'secondary', onPress: close },
        { id: 'save', label: t('pagesPlus.elements.save.submit'), variant: 'primary', onPress: submit },
      ]}
    >
      <div className={styles.form}>
        <TextField
          label={t('pagesPlus.elements.save.name')}
          value={name}
          onChange={setName}
          error={error ?? undefined}
          onCommit={() => void submit()}
          autoSelect
        />
        <TextField
          label={t('pagesPlus.elements.save.folder')}
          value={folder}
          onChange={setFolder}
          help={t('pagesPlus.elements.save.folderHelp')}
          onCommit={() => void submit()}
        />
      </div>
    </Dialog>
  );
}

type Editing = { readonly kind: 'rename'; readonly id: string; readonly value: string } | { readonly kind: 'folder' };

function Card({
  entry,
  platform,
  edit,
  report,
  close,
}: {
  entry: ElementEntry;
  platform: Platform;
  edit(editing: Editing): void;
  report(text: string | null): void;
  close(): void;
}) {
  const picture = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(thumbnail(entry.element))}`,
    [entry.element],
  );
  const insert = async () => {
    if (await insertEntry(entry).catch(() => false)) {
      close();
      showToast({ message: t('pagesPlus.elements.library.inserted', { name: entry.name }) });
    } else report(t('pagesPlus.elements.library.insertFailed'));
  };
  const share = () =>
    saveFile(platform, {
      suggested: `${fileSafe(entry.name, 'element')}${ELEMENT_EXTENSION}`,
      label: t('pagesPlus.elements.library.fileLabel'),
      extension: ELEMENT_EXTENSION.slice(1),
      bytes: new TextEncoder().encode(writeElementFile(entry.name, entry.element)),
    }).catch(() => report(t('pagesPlus.elements.errors.notSaved')));
  const remove = async () => {
    const changed = await changeLibrary((library) => removeElement(library, entry.id));
    if (changed.error) report(errorText(changed.error));
    else showToast({ message: t('pagesPlus.elements.library.deleted', { name: entry.name }) });
  };
  return (
    <li className={styles.card}>
      <img className={styles.cardPicture} src={picture} alt="" />
      <span className={styles.itemName}>{entry.name}</span>
      <div className={styles.buttons}>
        <Button
          variant="primary"
          aria-label={t('pagesPlus.elements.library.insertLabel', { name: entry.name })}
          onClick={() => void insert()}
        >
          {t('pagesPlus.elements.library.insert')}
        </Button>
        <Button
          variant="quiet"
          aria-label={t('pagesPlus.elements.library.renameLabel', { name: entry.name })}
          onClick={() => edit({ kind: 'rename', id: entry.id, value: entry.name })}
        >
          {t('pagesPlus.elements.library.rename')}
        </Button>
        <Button
          variant="quiet"
          aria-label={t('pagesPlus.elements.library.exportLabel', { name: entry.name })}
          onClick={() => void share()}
        >
          {t('pagesPlus.elements.library.export')}
        </Button>
        <Button
          variant="quiet"
          aria-label={t('pagesPlus.elements.library.deleteLabel', { name: entry.name })}
          onClick={() => void remove()}
        >
          {t('pagesPlus.elements.library.delete')}
        </Button>
      </div>
    </li>
  );
}

const whole = (library: ElementLibrary) => library;

export function ElementsDialog({ platform, close }: { platform: Platform; close(): void }) {
  const library = useStore(elementLibrary, whole);
  const [folder, setFolder] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<Editing | null>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const searching = query.trim() !== '';
  const listing = useMemo(() => listFolder(library, folder), [library, folder]);
  const found = useMemo(() => (searching ? searchElements(library, query) : []), [library, query, searching]);
  const entries = searching ? found : listing.entries;
  const apply = async (change: (l: typeof library) => LibraryResult) => {
    const changed = await changeLibrary(change);
    setMessage(changed.error ? errorText(changed.error) : null);
    if (!changed.error || changed.error === 'notSaved') setEditing(null);
  };
  const commit = () => {
    if (!editing) return;
    if (editing.kind === 'folder') void apply((l) => createFolder(l, folder, text));
    else void apply((l) => renameElement(l, editing.id, text));
  };
  const importFile = async () => {
    const source = await pickTextFile(`${ELEMENT_EXTENSION},application/json`);
    if (source === null) return;
    const read = readElementFile(source);
    if (!read.ok) return setMessage(errorText(read.error));
    await apply((l) =>
      addElement(l, {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        name: read.name,
        folder,
        created: new Date().toISOString(),
        element: read.element,
      }),
    );
    showToast({
      message:
        t('pagesPlus.elements.library.imported', { name: read.name }) +
        (read.warnings.length > 0
          ? ` ${t('pagesPlus.elements.library.importSkipped', { count: read.warnings.length })}`
          : ''),
    });
  };
  const parts = folder === '' ? [] : folder.split('/');
  const empty = library.entries.length === 0 && allFolders(library).length === 0;
  return (
    <Dialog
      title={t('pagesPlus.elements.library.title')}
      description={t('pagesPlus.elements.library.description')}
      size="large"
      onDismiss={close}
      actions={[{ id: 'close', label: t('pagesPlus.elements.library.close'), variant: 'primary', onPress: close }]}
    >
      <div className={styles.form}>
        <TextField label={t('pagesPlus.elements.library.search')} value={query} onChange={setQuery} />
        <div className={styles.buttons}>
          {!searching && folder !== '' ? (
            <Button variant="quiet" onClick={() => setFolder(parts.slice(0, -1).join('/'))}>
              {t('pagesPlus.elements.library.up')}
            </Button>
          ) : null}
          <span className={styles.hint} aria-live="polite">
            {[t('pagesPlus.elements.library.root'), ...parts].join(' / ')}
          </span>
          <Button
            variant="secondary"
            onClick={() => {
              setText('');
              setEditing({ kind: 'folder' });
            }}
          >
            {t('pagesPlus.elements.library.newFolder')}
          </Button>
          <Button variant="secondary" onClick={() => void importFile()}>
            {t('pagesPlus.elements.library.import')}
          </Button>
        </div>
        {editing ? (
          <div className={styles.buttons}>
            <TextField
              label={t(
                editing.kind === 'folder'
                  ? 'pagesPlus.elements.library.folderName'
                  : 'pagesPlus.elements.library.renameField',
              )}
              value={text}
              onChange={setText}
              onCommit={commit}
              onCancel={() => setEditing(null)}
              autoSelect
            />
            <Button variant="primary" onClick={commit}>
              {t(
                editing.kind === 'folder'
                  ? 'pagesPlus.elements.library.create'
                  : 'pagesPlus.elements.library.renameApply',
              )}
            </Button>
          </div>
        ) : null}
        {message ? (
          <p className={styles.error} role="alert">
            {message}
          </p>
        ) : null}
        {!searching && listing.folders.length > 0 ? (
          <ul className={styles.items}>
            {listing.folders.map((path) => {
              const name = path.split('/').at(-1) ?? path;
              return (
                <li key={path} className={styles.item}>
                  <Button
                    variant="quiet"
                    aria-label={t('pagesPlus.elements.library.openFolder', { name })}
                    onClick={() => setFolder(path)}
                  >
                    {name}
                  </Button>
                  <Button
                    variant="quiet"
                    aria-label={t('pagesPlus.elements.library.deleteFolderLabel', { name })}
                    onClick={() => void apply((l) => removeFolder(l, path, 'keep'))}
                  >
                    {t('pagesPlus.elements.library.delete')}
                  </Button>
                </li>
              );
            })}
          </ul>
        ) : null}
        {entries.length > 0 ? (
          <ul className={styles.cards}>
            {entries.map((entry) => (
              <Card
                key={entry.id}
                entry={entry}
                platform={platform}
                close={close}
                report={setMessage}
                edit={(next) => {
                  setText(next.kind === 'rename' ? next.value : '');
                  setEditing(next);
                }}
              />
            ))}
          </ul>
        ) : (
          <p className={styles.hint}>
            {searching
              ? t('pagesPlus.elements.library.noMatch', { query })
              : empty
                ? t('pagesPlus.elements.library.empty')
                : ''}
          </p>
        )}
      </div>
    </Dialog>
  );
}

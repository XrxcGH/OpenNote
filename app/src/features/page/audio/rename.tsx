// Naming a recording (More > Rename recording): the name shows on the card and in the block's name, so recordings
// on one page, or on pages that share a title, can be told apart. It is kept in the entry's `name` field, which
// the note format keeps untouched as an extra field. An empty name goes back to none.
import { useId, useRef, useState } from 'react';
import type { RecordingEntry } from '../../../core/audio';
import { t } from '../../../strings/t';
import { announce, Dialog } from '../../../ui';
import styles from './audio.module.css';
import { writeEntry } from './blocks';
import { openDialog } from './dialog';
import { nameOf } from './entry';

/** The longest name a recording keeps. */
const MAX_NAME = 120;

/** The entry with this name, or with no name when it is blank. */
export function named(entry: RecordingEntry, name: string): RecordingEntry {
  const clean = name.trim().slice(0, MAX_NAME);
  const { name: _old, ...rest } = entry;
  return clean ? { ...rest, name: clean } : rest;
}

function RenameDialog(props: { entry: RecordingEntry; onDone(name: string | null): void }) {
  const [name, setName] = useState(nameOf(props.entry) ?? '');
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  return (
    <Dialog
      title={t('audio.block.renameTitle')}
      onDismiss={() => props.onDone(null)}
      initialFocus={input}
      actions={[
        { id: 'cancel', label: t('audio.block.cancel'), variant: 'secondary', onPress: () => props.onDone(null) },
        { id: 'save', label: t('audio.block.renameSave'), variant: 'primary', onPress: () => props.onDone(name) },
      ]}
    >
      <div className={styles.field}>
        <label htmlFor={inputId}>{t('audio.block.renameLabel')}</label>
        <input
          ref={input}
          id={inputId}
          className={styles.select}
          value={name}
          maxLength={MAX_NAME}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') props.onDone(name);
          }}
        />
      </div>
    </Dialog>
  );
}

/** Asks for a name, then saves it on the recording. */
export async function renameRecording(pageId: string, block: string, entry: RecordingEntry): Promise<void> {
  let chosen: string | null = null;
  await openDialog((close) => (
    <RenameDialog
      entry={entry}
      onDone={(name) => {
        chosen = name;
        close();
      }}
    />
  ));
  if (chosen === null) return;
  const next = named(entry, chosen);
  await writeEntry(pageId, block, next);
  announce(t('audio.block.renamed', { name: nameOf(next) ?? t('audio.block.unnamed') }));
}

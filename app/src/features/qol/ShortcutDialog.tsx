// Where a new shortcut goes: the desktop, the Start menu, or a folder the person picks. The last choice is the
// starting point next time.
import { useState } from 'react';
import type { Platform } from '../../platform/types';
import { t } from '../../strings/t';
import { Button, Dialog, RadioCard, RadioGroup } from '../../ui';

export type ShortcutPlace = 'desktop' | 'startMenu' | 'folder';

export interface ShortcutChoice {
  place: ShortcutPlace;
  /** The folder, for the place `folder`. */
  folder: string | null;
}

const KEY = 'opennote.shortcutPlace';

/** The place used last, or the desktop. */
export function rememberedPlace(): ShortcutPlace {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'startMenu' || value === 'folder' ? value : 'desktop';
  } catch {
    return 'desktop';
  }
}

export function rememberPlace(place: ShortcutPlace): void {
  try {
    localStorage.setItem(KEY, place);
  } catch {
    // The choice is only a convenience.
  }
}

export function ShortcutDialog({
  title,
  platform,
  done,
}: {
  title: string;
  platform: Platform;
  done(choice: ShortcutChoice | null): void;
}) {
  const [place, setPlace] = useState<ShortcutPlace>(rememberedPlace);
  const [folder, setFolder] = useState<string | null>(null);
  const choose = async () => {
    const picked = await platform.interop.pick('folder', folder).catch(() => null);
    if (picked) setFolder(picked);
    return picked;
  };
  const create = async () => {
    let chosen = folder;
    if (place === 'folder' && !chosen) chosen = await choose();
    if (place === 'folder' && !chosen) return;
    rememberPlace(place);
    done({ place, folder: place === 'folder' ? chosen : null });
  };
  return (
    <Dialog
      title={t('qol.shortcut.title')}
      description={t('qol.shortcut.description', { title })}
      size="small"
      onDismiss={() => done(null)}
      actions={[
        { id: 'cancel', label: t('common.cancel'), variant: 'secondary', onPress: () => done(null) },
        { id: 'create', label: t('qol.shortcut.create'), variant: 'primary', onPress: create },
      ]}
    >
      <RadioGroup<ShortcutPlace> label={t('qol.shortcut.where')} value={place} onChange={setPlace}>
        <RadioCard value="desktop" label={t('qol.shortcut.desktop')} />
        <RadioCard value="startMenu" label={t('qol.shortcut.startMenu')} />
        <RadioCard
          value="folder"
          label={t('qol.shortcut.folder')}
          description={folder ?? t('qol.shortcut.folderNone')}
        />
      </RadioGroup>
      {place === 'folder' ? (
        <Button variant="secondary" onClick={() => void choose()}>
          {folder ? t('qol.shortcut.changeFolder') : t('qol.shortcut.chooseFolder')}
        </Button>
      ) : null}
    </Dialog>
  );
}

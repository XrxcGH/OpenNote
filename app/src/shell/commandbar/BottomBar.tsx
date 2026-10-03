// The compact layout's bottom bar (ARCHITECTURE.md section 11.1), a navigation landmark with 44 px targets:
// Notebooks, Search, New page, and More. More holds Settings, Keyboard shortcuts, the title bar items placed
// there (such as the update chip), and Trash. Buttons show only when their command exists and is available.

import { BooksIcon } from '@phosphor-icons/react/dist/csr/Books';
import { DotsThreeIcon } from '@phosphor-icons/react/dist/csr/DotsThree';
import { FilePlusIcon } from '@phosphor-icons/react/dist/csr/FilePlus';
import { MagnifyingGlassIcon } from '@phosphor-icons/react/dist/csr/MagnifyingGlass';
import { useEffect, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import { ariaKeyShortcuts, formatChord, useKeysFor } from '../../commands/keymap';
import { executeCommand } from '../../commands/registry';
import type { CommandId } from '../../commands/types';
import { titleBarItems, useRegistry } from '../../registries';
import { useSizeClass } from '../../state/layout';
import { t } from '../../strings/t';
import type { MessageKey } from '../../strings/t';
import { Popover, Tooltip } from '../../ui';
import type { IconProps } from '../../ui';
import { useRegion } from '../regions';
import styles from './CommandBar.module.css';
import { useAvailable } from './useBarItems';

interface BottomAction {
  command: CommandId;
  label: MessageKey;
  icon: ComponentType<IconProps>;
}

const ACTIONS: readonly BottomAction[] = [
  { command: 'layout.toggleNotebooks', label: 'commands.bar.notebooks', icon: BooksIcon },
  { command: 'app.palette', label: 'commands.bar.search', icon: MagnifyingGlassIcon },
  { command: 'notes.newPage', label: 'commands.bar.newPage', icon: FilePlusIcon },
];

const MORE: readonly { command: CommandId; label: MessageKey }[] = [
  { command: 'app.settings', label: 'commands.bar.settings' },
  { command: 'app.shortcuts', label: 'commands.bar.shortcuts' },
];
const MORE_LAST: readonly { command: CommandId; label: MessageKey }[] = [
  { command: 'trash.open', label: 'commands.bar.trash' },
];

function ActionButton({ action }: { action: BottomAction }) {
  const keys = useKeysFor(action.command);
  const label = t(action.label);
  const Icon = action.icon;
  const button = (
    <button
      type="button"
      className={styles.bottomButton}
      aria-keyshortcuts={keys.length ? ariaKeyShortcuts(keys) : undefined}
      onClick={() => void executeCommand(action.command, undefined, 'commandBar')}
    >
      <Icon aria-hidden />
      {label}
    </button>
  );
  // The button shows its label, so a tooltip only earns its place when it adds the shortcut.
  return keys[0] ? (
    <Tooltip label={label} shortcut={formatChord(keys[0])}>
      {button}
    </Tooltip>
  ) : (
    button
  );
}

function MoreItems({ onDone }: { onDone(): void }) {
  const available = useAvailable();
  const placed = useRegistry(titleBarItems).filter((item) => item.compact === 'bottomMore');
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => list.current?.querySelector<HTMLElement>('button, [href], [tabindex="0"]')?.focus(), []);
  const run = (command: CommandId) => {
    onDone();
    void executeCommand(command, undefined, 'commandBar');
  };
  const entry = ({ command, label }: { command: CommandId; label: MessageKey }) =>
    available(command) && (
      <li key={command}>
        <button type="button" className={styles.moreItem} onClick={() => run(command)}>
          {t(label)}
        </button>
      </li>
    );
  return (
    <ul className={styles.moreList} ref={list}>
      {MORE.map(entry)}
      {placed.map(({ id, Component }) => (
        <li key={id}>
          <Component presentation="menuItem" />
        </li>
      ))}
      {MORE_LAST.map(entry)}
    </ul>
  );
}

export function BottomBar() {
  const sizeClass = useSizeClass();
  const region = useRegion('commandBar');
  const available = useAvailable();
  const more = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  if (sizeClass !== 'compact') return null;
  const moreLabel = t('commands.bar.moreLabel');
  return (
    <nav aria-label={t('commands.bar.bottom')} className={styles.bottomBar} {...region}>
      {ACTIONS.filter((action) => available(action.command)).map((action) => (
        <ActionButton key={action.command} action={action} />
      ))}
      <Tooltip label={moreLabel}>
        <button
          type="button"
          ref={more}
          className={styles.bottomButton}
          aria-label={moreLabel}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <DotsThreeIcon aria-hidden />
          {t('commands.bar.more')}
        </button>
      </Tooltip>
      <Popover
        anchor={more}
        label={moreLabel}
        open={open}
        onClose={() => {
          setOpen(false);
          more.current?.focus();
        }}
      >
        <MoreItems onDone={() => setOpen(false)} />
      </Popover>
    </nav>
  );
}

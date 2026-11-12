// The project's files (DESIGN 5.1): a tree beside the editor in a wide window, the tabs of the open files, and a
// Files menu in a narrow one. Tabs and rows show the language badge, the main file, and a dot while the page does
// not have the file's latest text yet. New file and Rename take the name in a field in place.
import { DotsThreeVertical, FilePlus, Files as FilesIcon, X } from '@phosphor-icons/react';
import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, RefObject } from 'react';
import { t } from '../../../strings/t';
import { IconButton, openMenu } from '../../../ui';
import type { MenuItemSpec } from '../../../ui';
import type { StudioController } from './controller';
import { badgeOf, fileLanguage } from './languages';
import styles from './studio.module.css';

type Editing = { mode: 'new' } | { mode: 'rename'; id: string } | null;

function Badge({ path }: { path: string }) {
  const language = fileLanguage(path);
  return (
    <span className={styles.badge} data-language={language} aria-hidden>
      {badgeOf(language)}
    </span>
  );
}

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1);

/**
 * The name field in place. `onDone` gets the name, or null on Escape or when focus leaves; `blurred` is true when
 * focus left, so the studio does not take it back.
 */
function NameForm(props: { initial: string; onDone(name: string | null, blurred?: boolean): void; label: string }) {
  const [name, setName] = useState(props.initial);
  const id = useId();
  return (
    <form
      className={styles.nameForm}
      onSubmit={(event) => {
        event.preventDefault();
        props.onDone(name.trim());
      }}
    >
      <label className={styles.visuallyHidden} htmlFor={id}>
        {props.label}
      </label>
      <input
        id={id}
        autoFocus
        value={name}
        spellCheck={false}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            props.onDone(null);
          }
        }}
        onBlur={() => props.onDone(null, true)}
      />
    </form>
  );
}

/** The actions on one file, for its menu. */
function fileItems(controller: StudioController, id: string, edit: (next: Editing) => void): MenuItemSpec[] {
  const project = controller.project();
  const editable = controller.store?.editable ?? false;
  return [
    {
      id: 'rename',
      label: t('codeStudio.studio.files.rename'),
      disabled: !editable,
      onSelect: () => edit({ mode: 'rename', id }),
    },
    {
      id: 'main',
      label: t('codeStudio.studio.files.setMain'),
      disabled: !editable || project?.main === id,
      onSelect: () => void controller.setMain(id),
    },
    { id: 'download', label: t('codeStudio.studio.files.download'), onSelect: () => void controller.downloadFile(id) },
    {
      id: 'delete',
      label: t('codeStudio.studio.files.delete'),
      danger: true,
      disabled: !editable || project?.main === id,
      separatorBefore: true,
      onSelect: () => void controller.removeFile(id),
    },
  ];
}

/** Opens a file's actions menu at an anchor. */
function openFileMenu(controller: StudioController, id: string, edit: (next: Editing) => void, anchor: HTMLElement) {
  void openMenu({
    label: t('codeStudio.studio.files.actions', { name: controller.pathOf(id) }),
    anchor,
    items: fileItems(controller, id, edit),
  });
}

/** The keys a file row or tab is given: Shift+F10 or the menu key for its actions, F2 to rename, Delete. */
const FILE_KEYS = 'Shift+F10 F2 Delete';
const TAB_KEYS = 'Shift+F10 F2 Control+F4';

function fileKeys(
  event: KeyboardEvent<HTMLElement>,
  controller: StudioController,
  id: string,
  edit: (next: Editing) => void,
  allowDelete: boolean,
): void {
  const editable = controller.store?.editable ?? false;
  if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
    event.preventDefault();
    openFileMenu(controller, id, edit, event.currentTarget);
  } else if (event.key === 'F2' && !event.shiftKey && editable) {
    event.preventDefault();
    edit({ mode: 'rename', id });
  } else if (event.key === 'Delete' && allowDelete && editable && controller.project()?.main !== id) {
    event.preventDefault();
    void controller.removeFile(id);
  } else if (event.key === 'F4' && event.ctrlKey && !allowDelete) {
    // Ctrl+F4 closes the tab, as in other editors.
    event.preventDefault();
    controller.closeTab(id);
  }
}

/** The row or tab of a file inside a strip, by its `data-file`. */
function fileControl(scope: HTMLElement | null, id: string): HTMLElement | null {
  for (const element of scope?.querySelectorAll<HTMLElement>('[data-file]') ?? []) {
    if (element.dataset.file === id) return element;
  }
  return null;
}

/**
 * New file and Rename in place. When the name field closes by Enter or Escape, focus goes on: to the renamed or new
 * file's row or tab, or back to the control that opened the field. So a keyboard user keeps their place.
 */
function useEditing(controller: StudioController, scope: RefObject<HTMLElement | null>) {
  const [editing, setEditingState] = useState<Editing>(null);
  const opener = useRef<HTMLElement | null>(null);
  const focusNext = useRef<(() => void) | null>(null);
  useLayoutEffect(() => {
    const run = focusNext.current;
    focusNext.current = null;
    run?.();
  });
  const setEditing = (next: Editing) => {
    const active = document.activeElement;
    opener.current = active instanceof HTMLElement && active !== document.body ? active : null;
    setEditingState(next);
  };
  const done = (name: string | null, blurred = false) => {
    const now = editing;
    setEditingState(null);
    if (!now) return;
    let target: string | null = null;
    if (name && now.mode === 'new') target = controller.newFile(name) ? controller.activeFile : null;
    else if (name && now.mode === 'rename') {
      target = name === controller.pathOf(now.id) || controller.renameFile(now.id, name) ? now.id : null;
    }
    if (blurred) return;
    const back = opener.current;
    focusNext.current = () => {
      const file = target ? fileControl(scope.current, target) : null;
      if (file) file.focus();
      else if (back?.isConnected) back.focus();
      else if (now.mode === 'rename') fileControl(scope.current, now.id)?.focus();
    };
  };
  return { editing, setEditing, done };
}

function Notice({ controller }: { controller: StudioController }) {
  return (
    <p className={styles.notice} role="status">
      {controller.notice}
    </p>
  );
}

export function FileTree({ controller }: { controller: StudioController }) {
  const project = controller.project()!;
  const tree = useRef<HTMLElement>(null);
  const { editing, setEditing, done } = useEditing(controller, tree);
  const editable = controller.store?.editable ?? false;
  return (
    <nav ref={tree} className={styles.tree} aria-label={t('codeStudio.studio.files.label')}>
      <div className={styles.treeHead}>
        <span>{t('codeStudio.studio.files.label')}</span>
        <IconButton
          label={t('codeStudio.studio.files.newFile')}
          icon={FilePlus}
          disabled={editable ? false : 'aria'}
          onPress={() => setEditing({ mode: 'new' })}
        />
      </div>
      {editing?.mode === 'new' && <NameForm initial="" label={t('codeStudio.studio.files.newName')} onDone={done} />}
      <ul className={styles.treeList}>
        {controller.fileIds().map((id) => {
          const path = project.files[id]!.path;
          if (editing?.mode === 'rename' && editing.id === id) {
            return (
              <li key={id}>
                <NameForm initial={path} label={t('codeStudio.studio.files.newName')} onDone={done} />
              </li>
            );
          }
          return (
            <li key={id} className={styles.treeRow} data-active={controller.activeFile === id || undefined}>
              <button
                type="button"
                className={styles.treeFile}
                data-file={id}
                aria-current={controller.activeFile === id ? 'true' : undefined}
                aria-keyshortcuts={FILE_KEYS}
                onClick={() => controller.openFile(id)}
                onKeyDown={(event) => fileKeys(event, controller, id, setEditing, true)}
              >
                <Badge path={path} />
                <span className={styles.fileName}>{path}</span>
                {project.main === id && <span className={styles.mainMark}>{t('codeStudio.studio.files.main')}</span>}
                {controller.dirty.has(id) && (
                  <span className={styles.dirty} title={t('codeStudio.studio.files.unsent')}>
                    <span className={styles.visuallyHidden}>{t('codeStudio.studio.files.unsent')}</span>
                  </span>
                )}
              </button>
              <FileMenuButton controller={controller} id={id} edit={setEditing} />
            </li>
          );
        })}
      </ul>
      <Notice controller={controller} />
    </nav>
  );
}

function FileMenuButton(props: { controller: StudioController; id: string; edit: (next: Editing) => void }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const name = props.controller.pathOf(props.id);
  return (
    <span ref={anchor}>
      <IconButton
        label={t('codeStudio.studio.files.actions', { name })}
        icon={DotsThreeVertical}
        hasPopup="menu"
        onPress={() => openFileMenu(props.controller, props.id, props.edit, anchor.current!)}
      />
    </span>
  );
}

export function TabStrip({ controller, withFilesMenu }: { controller: StudioController; withFilesMenu: boolean }) {
  const project = controller.project()!;
  const strip = useRef<HTMLDivElement>(null);
  const { editing, setEditing, done } = useEditing(controller, strip);
  const menuAnchor = useRef<HTMLSpanElement>(null);
  const filesMenu = () =>
    void openMenu({
      label: t('codeStudio.studio.files.label'),
      anchor: menuAnchor.current!,
      items: [
        ...controller.fileIds().map((id) => ({
          id,
          label: project.files[id]!.path,
          kind: 'radio' as const,
          checked: controller.activeFile === id,
          onSelect: () => controller.openFile(id),
        })),
        {
          id: 'new',
          label: t('codeStudio.studio.files.newFile'),
          separatorBefore: true,
          disabled: !(controller.store?.editable ?? false),
          onSelect: () => setEditing({ mode: 'new' }),
        },
        ...(controller.activeFile ? fileItems(controller, controller.activeFile, setEditing) : []),
      ],
    });
  return (
    <div ref={strip} className={styles.tabsRow}>
      {withFilesMenu && (
        <span ref={menuAnchor}>
          <IconButton label={t('codeStudio.studio.files.label')} icon={FilesIcon} hasPopup="menu" onPress={filesMenu} />
        </span>
      )}
      {editing && (
        <NameForm
          initial={editing.mode === 'rename' ? controller.pathOf(editing.id) : ''}
          label={t('codeStudio.studio.files.newName')}
          onDone={done}
        />
      )}
      <div className={styles.tabs} role="group" aria-label={t('codeStudio.studio.files.open')}>
        {controller.tabs.map((id) => {
          const path = controller.pathOf(id);
          const selected = controller.activeFile === id;
          return (
            <div key={id} className={styles.tab} data-active={selected || undefined}>
              <button
                type="button"
                aria-current={selected ? 'true' : undefined}
                title={path}
                className={styles.tabButton}
                data-file={id}
                aria-keyshortcuts={TAB_KEYS}
                onClick={() => controller.openFile(id)}
                onKeyDown={(event) => fileKeys(event, controller, id, setEditing, false)}
              >
                <Badge path={path} />
                <span className={styles.fileName}>{baseName(path)}</span>
                {controller.dirty.has(id) && (
                  <span className={styles.dirty} title={t('codeStudio.studio.files.unsent')}>
                    <span className={styles.visuallyHidden}>{t('codeStudio.studio.files.unsent')}</span>
                  </span>
                )}
              </button>
              <IconButton
                label={t('codeStudio.studio.files.close', { name: baseName(path) })}
                icon={X}
                onPress={() => controller.closeTab(id)}
              />
            </div>
          );
        })}
      </div>
      {withFilesMenu && <Notice controller={controller} />}
    </div>
  );
}

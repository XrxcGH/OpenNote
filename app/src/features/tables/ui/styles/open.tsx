// Opens the Cell styles dialog and the Format as table gallery for the current table, and runs the format painter.
// Every change is one data patch of the table (sheet/formatTarget.ts and the writers of this folder), so Undo takes
// each back in one step. The dialogs follow the table through the hosts' version, so a change shows at once.
import { useSyncExternalStore } from 'react';
import { t } from '../../../../strings/t';
import type { MessageKey } from '../../../../strings/t';
import type { TableExtraHost } from '../../../page';
import { boxOfSelection } from '../../sheet/formatTarget';
import { readSheet } from '../../sheet/model';
import type { CellStyle, Sheet, StyleChange } from '../../sheet/model';
import { currentScheme } from '../../sheet/render/plugin';
import { showDialog } from '../formatCells/mount';
import { notebookOf } from '../formatCells/open';
import { hostsVersion, subscribeHosts } from '../toolbar/hosts';
import { CellStyles, labelOf } from './CellStyles';
import { LooksGallery } from './LooksGallery';
import { BUILTIN_KEYS, applyStyle, changeNamed, freeName, listStyles, removeNamed, setNamed, usesOf } from './named';
import type { Written } from './named';
import { directStyle } from './painter';
import { lookLabel } from './LooksGallery';
import { lookOf, setLook } from './tableLook';

const sheetOf = (host: TableExtraHost): Sheet => readSheet(host.data());

/** Sends a writer's patch, or says why nothing was written. Returns whether a change went through. */
async function send(host: TableExtraHost, done: Written): Promise<boolean> {
  if (done.refused === 'styles') host.announce(t('sheetFormat.announce.tooMany'));
  else if (done.refused === 'name') host.announce(t('sheetFormat.styles.announceInvalid'));
  if (!done.patch) return false;
  await host.patch(done.patch);
  return true;
}

function StylesDialog({ host, close }: { host: TableExtraHost; close: () => void }) {
  useSyncExternalStore(subscribeHosts, hostsVersion);
  const sheet = sheetOf(host);
  const table = host.table();
  const box = boxOfSelection(host.editor.state, table);
  const list = listStyles(sheet);
  const builtinLabels = BUILTIN_KEYS.map((key) => t(`sheetFormat.styles.builtin.${key}` as MessageKey));
  const name = (key: string) => labelOf(list.find((s) => s.key === key) ?? { key, builtin: false });
  return (
    <CellStyles
      list={list}
      uses={(key) => usesOf(sheet, key)}
      hasSelection={box !== null}
      scheme={currentScheme()}
      notebookId={notebookOf()}
      suggestName={freeName(sheet, t('sheetFormat.styles.newName'), builtinLabels)}
      onApply={(key) => {
        if (!box) return;
        void send(host, applyStyle(sheet, table, box, key)).then((done) => {
          if (done) host.announce(t('sheetFormat.styles.announceApplied', { name: name(key) }));
          close();
          host.editor.commands.focus();
        });
      }}
      onChange={(key, change: StyleChange) =>
        void send(host, changeNamed(sheet, table, key, change)).then(
          (done) => done && host.announce(t('sheetFormat.styles.announceChanged', { name: name(key) })),
        )
      }
      onAdd={(styleName) => {
        if (!box) return;
        const style: CellStyle = directStyle(sheet, table, box.top, box.left);
        void send(host, setNamed(sheet, table, styleName, style)).then(
          (done) => done && host.announce(t('sheetFormat.styles.announceAdded', { name: styleName })),
        );
      }}
      onRemove={(key) =>
        void send(host, removeNamed(sheet, table, key)).then(
          (done) => done && host.announce(t('sheetFormat.styles.announceRemoved', { name: name(key) })),
        )
      }
      onClose={() => {
        close();
        host.editor.commands.focus();
      }}
    />
  );
}

/** Shows the Cell styles dialog. Resolves when it closes. */
export const openCellStyles = (host: TableExtraHost): Promise<void> =>
  showDialog((close) => <StylesDialog host={host} close={close} />);

/** Shows the Format as table gallery. Applying writes the look, the options, and the header row in one change. */
export function openLooks(host: TableExtraHost): Promise<void> {
  const sheet = sheetOf(host);
  const table = host.table();
  return showDialog((close) => (
    <LooksGallery
      options={lookOf(sheet)}
      header={table.header}
      scheme={currentScheme()}
      onCancel={() => {
        close();
        host.editor.commands.focus();
      }}
      onApply={(options, header) => {
        close();
        const written = setLook(sheet, options);
        const headerChanged = header !== table.header;
        const run = headerChanged
          ? host.apply((data) => ({ ...data, header }), written.patch ?? {})
          : written.patch
            ? host.patch(written.patch)
            : Promise.resolve(false);
        void run.then(() => {
          host.announce(
            options.look
              ? t('sheetFormat.looks.announce', { name: lookLabel(options.look) })
              : t('sheetFormat.looks.announceNone'),
          );
          host.editor.commands.focus();
        });
      }}
    />
  ));
}

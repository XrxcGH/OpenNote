// Opens the conditional formatting rule manager for the current table (the conditional lane's hand-over to the
// cell commands). It lists the rules of the selection, the table, or the page. Each change is one data patch of the
// table the rule belongs to, so Undo takes it back in one step. It loads on first use.
import { useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { t } from '../../../../strings/t';
import { Dialog } from '../../../../ui/Dialog';
import type { TableExtraHost } from '../../../page';
import { boxOfSelection } from '../../sheet/formatTarget';
import { readSheet, type Box } from '../../sheet/model';
import { hostOfBlock, hostsOfPage, hostsVersion, subscribeHosts } from '../toolbar/hosts';
import { RuleManager } from './RuleManager';
import {
  deleteRule,
  managedPageRules,
  managedRules,
  moveRule,
  setStop,
  type Changed,
  type ManagedRule,
  type RuleRef,
  type Scope,
} from './manage';
import type { Sheet } from '../../sheet/model';

const sheetOf = (host: TableExtraHost): Sheet => readSheet(host.data());

/** The rules the manager lists for a scope. The page scope names each table by its place on the page. */
export function rulesFor(host: TableExtraHost, scope: Scope, selection: Box | null): ManagedRule[] {
  if (scope !== 'page') return managedRules(sheetOf(host), host.table(), scope, selection ?? undefined);
  return managedPageRules(
    hostsOfPage(host.page).map((h, i) => ({
      tableId: h.block,
      label: t('sheetConditional.manager.tableName', { number: i + 1 }),
      table: h.table(),
      sheet: sheetOf(h),
    })),
  );
}

/** Applies one change to the table a rule belongs to. Returns false when nothing changed. */
export async function changeRule(
  host: TableExtraHost,
  rule: RuleRef,
  edit: (sheet: Sheet, id: string) => Changed,
): Promise<boolean> {
  const owner = rule.tableId === undefined ? host : hostOfBlock(rule.tableId);
  if (!owner) return false;
  const { patch } = edit(sheetOf(owner), rule.ruleId);
  if (!patch) return false;
  await owner.patch(patch);
  return true;
}

function Manager({ host, selection, close }: { host: TableExtraHost; selection: Box | null; close: () => void }) {
  const [scope, setScope] = useState<Scope>(selection ? 'selection' : 'table');
  // The list follows each write, and undo or another window, through the hosts' version.
  useSyncExternalStore(subscribeHosts, hostsVersion);
  const rules = rulesFor(host, scope, selection);
  const run = (rule: RuleRef, edit: (sheet: Sheet, id: string) => Changed) => void changeRule(host, rule, edit);
  return (
    <Dialog title={t('sheetConditional.manager.title')} size="medium" onDismiss={close}>
      <RuleManager
        rules={rules}
        scope={scope}
        onScope={setScope}
        onMove={(rule, by) => run(rule, (sheet, id) => moveRule(sheet, id, by))}
        onStop={(rule, stop) => run(rule, (sheet, id) => setStop(sheet, id, stop))}
        onRemove={(rule) => run(rule, deleteRule)}
        onDone={close}
      />
    </Dialog>
  );
}

/** Shows the rule manager for a table. Resolves when it closes. */
export function openRuleManager(host: TableExtraHost): Promise<void> {
  const selection = boxOfSelection(host.editor.state, host.table());
  const mount = document.body.appendChild(document.createElement('div'));
  const root = createRoot(mount);
  return new Promise((resolve) => {
    let done = false;
    const close = () => {
      if (done) return;
      done = true;
      queueMicrotask(() => {
        root.unmount();
        mount.remove();
      });
      resolve();
    };
    root.render(<Manager host={host} selection={selection} close={close} />);
  });
}

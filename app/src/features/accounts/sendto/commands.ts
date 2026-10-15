// Send to Google Drive and Send to OneDrive, and Update the copy. The person chooses what to send (the lasso's selection,
// the page, its section, or its notebook), the file type, and the folder, and nothing is sent until the last button. A
// page, section, or notebook that was sent stays linked to its file, so after the notes change OpenNote can offer to
// update the copy. It offers once for each page in a session and never again until the page is opened next time.
import { getLocation } from '../../../app/location';
import { commandContext } from '../../../commands/registry';
import type { NodeId } from '../../../services/notes/types';
import { t } from '../../../strings/t';
import { announce, showToast } from '../../../ui';
import { connectors } from '../../connectors';
import { pageSelection, shownMounted } from '../../page';
import { accountsHost } from '../host';
import type { AccountsHost } from '../host';
import { attempt, isConnected, tellNotConnected } from '../run';
import { pickOne } from '../ui/prompts';
import type { Choice } from '../ui/prompts';
import { changedSince, copiesDue, copiesOf, copyOf, loadCopies, rememberCopy } from './copies';
import { boxDestination } from './box';
import { driveDestination } from './drive';
import { dropboxDestination } from './dropbox';
import { onedriveDestination } from './onedrive';
import { webdavDestination } from './webdav';
import { prepare } from './render';
import { OFFICE, officeOf } from './types';
import type { Destination, LocalFile, RemoteFolder, SendFormat, SendScope, SendService, SentCopy } from './types';

const NAMES = {
  drive: 'Google Drive',
  onedrive: 'OneDrive',
  dropbox: 'Dropbox',
  box: 'Box',
  webdav: 'WebDAV',
} as const;
const CONNECTOR = { drive: 'google', onedrive: 'microsoft', dropbox: 'dropbox', box: 'box', webdav: 'webdav' } as const;

export function destinationFor(service: SendService, host: AccountsHost = accountsHost()): Destination {
  const deps = { client: connectors(), host };
  switch (service) {
    case 'drive':
      return driveDestination(deps);
    case 'onedrive':
      return onedriveDestination(deps);
    case 'dropbox':
      return dropboxDestination(deps);
    case 'box':
      return boxDestination(deps);
    case 'webdav':
      return webdavDestination(deps);
  }
}

/** The types of file a scope can be sent as, for a service. */
export function formatsFor(service: SendService, scope: SendScope): SendFormat[] {
  const converted: SendFormat[] = service === 'drive' ? ['gdoc', 'gsheet', 'gslides'] : [];
  // A selection is a picture, so it can stay a picture or go in a Word file; the rest can be any Office file.
  if (scope === 'selection') return ['png', 'docx', ...converted.slice(0, 1)];
  const office: SendFormat[] = ['docx', 'xlsx', 'pptx', ...converted];
  return scope === 'page' ? ['pdf', ...office] : office;
}

/** Sends a prepared file, new or over an earlier copy, and links the node to it. Resolves the record. */
export async function sendFile(
  destination: Destination,
  local: LocalFile,
  options: {
    node: string;
    scope: SendScope;
    format: SendFormat;
    folder: string | null;
    folderName: string;
    replace?: string;
    host?: AccountsHost;
    now?: Date;
  },
): Promise<SentCopy> {
  const office = officeOf(options.format);
  const convertTo = office?.convert ? OFFICE[office.type].convertTo : null;
  const sent = options.replace
    ? await destination.replace(local, options.replace)
    : await destination.send(local, options.folder, convertTo);
  const copy = copyOf(
    {
      service: destination.service,
      node: options.node,
      scope: options.scope === 'selection' ? 'page' : options.scope,
      format: options.format,
      folder: options.folderName,
    },
    sent,
    options.now,
  );
  // A selection can't be made again later, so it isn't linked.
  if (options.scope !== 'selection') await rememberCopy(copy, options.host);
  return copy;
}

/** Walks the folders of the service: use this one, open one inside it, or go back up. */
async function chooseFolder(destination: Destination): Promise<{ id: string | null; name: string } | null> {
  type Step = { kind: 'use' } | { kind: 'open'; folder: RemoteFolder } | { kind: 'up' };
  const trail: RemoteFolder[] = [];
  const top = t('accounts.sendTo.folder.top');
  for (;;) {
    const here = trail[trail.length - 1] ?? null;
    const inside = await destination.folders(here?.id ?? null);
    const choices: Choice<Step>[] = [
      { id: 'use', label: t('accounts.sendTo.folder.use', { name: here?.name ?? top }), value: { kind: 'use' } },
      ...inside.map((folder) => ({
        id: folder.id,
        label: folder.name,
        detail: t('accounts.sendTo.folder.open'),
        value: { kind: 'open', folder } as Step,
      })),
      ...(here ? [{ id: 'up', label: t('accounts.sendTo.folder.up'), value: { kind: 'up' } as Step }] : []),
    ];
    const step = await pickOne<Step>({
      title: t('accounts.sendTo.folder.title'),
      description: t('accounts.sendTo.folder.description', { name: here?.name ?? top }),
      confirmLabel: t('accounts.sendTo.folder.confirm'),
      choices,
    });
    if (!step) return null;
    if (step.kind === 'use') return { id: here?.id ?? null, name: here?.name ?? top };
    if (step.kind === 'open') trail.push(step.folder);
    else trail.pop();
  }
}

interface Where {
  page: NodeId | null;
  section: NodeId | null;
  notebook: NodeId | null;
}

function whereNow(): Where {
  const here = getLocation();
  return here.view === 'workspace'
    ? { page: here.pageId, section: here.sectionId, notebook: here.notebookId }
    : { page: null, section: null, notebook: null };
}

async function titleOf(node: NodeId | null, fallback: string): Promise<string> {
  const found = node ? await commandContext('palette').notes.get(node) : null;
  return found?.title.trim() || fallback;
}

function chosenOnPage(): boolean {
  const { blocks, strokes } = pageSelection.get();
  return blocks.length + strokes.length > 0;
}

export async function sendTo(service: SendService, preset?: { format: SendFormat }): Promise<void> {
  const name = NAMES[service];
  if (!shownMounted.get()) return void showToast({ message: t('accounts.sendTo.nothing') });
  if (!(await isConnected(CONNECTOR[service]))) return tellNotConnected(name);
  const where = whereNow();
  const scopes: Choice<SendScope>[] = [];
  if (chosenOnPage()) {
    scopes.push({ id: 'selection', label: t('accounts.sendTo.scope.selection'), value: 'selection' });
  }
  if (where.page) scopes.push({ id: 'page', label: t('accounts.sendTo.scope.page'), value: 'page' });
  if (where.section) scopes.push({ id: 'section', label: t('accounts.sendTo.scope.section'), value: 'section' });
  if (where.notebook) scopes.push({ id: 'notebook', label: t('accounts.sendTo.scope.notebook'), value: 'notebook' });
  const scope = await pickOne<SendScope>({
    title: t('accounts.sendTo.scope.title', { service: name }),
    description: t('accounts.sendTo.scope.description'),
    confirmLabel: t('accounts.sendTo.scope.confirm'),
    choices: scopes,
    empty: t('accounts.sendTo.nothing'),
  });
  if (!scope) return;
  const labels: Record<SendFormat, string> = {
    pdf: t('accounts.sendTo.format.pdf'),
    docx: t('accounts.sendTo.format.docx'),
    xlsx: t('accounts.sendTo.format.xlsx'),
    pptx: t('accounts.sendTo.format.pptx'),
    gdoc: t('accounts.sendTo.format.gdoc'),
    gsheet: t('accounts.sendTo.format.gsheet'),
    gslides: t('accounts.sendTo.format.gslides'),
    png: t('accounts.sendTo.format.png'),
  };
  const offered = formatsFor(service, scope);
  const format =
    preset && offered.includes(preset.format)
      ? preset.format
      : await pickOne<SendFormat>({
          title: t('accounts.sendTo.format.title'),
          confirmLabel: t('accounts.sendTo.format.confirm'),
          choices: offered.map((one) => ({ id: one, label: labels[one], value: one })),
        });
  if (!format) return;
  await attempt(name, async () => {
    const destination = destinationFor(service);
    const folder = await chooseFolder(destination);
    if (!folder) return;
    const node = scope === 'selection' ? where.page : where[scope];
    const title = await titleOf(node, t('accounts.sendTo.untitled'));
    const host = accountsHost();
    announce(t('accounts.sendTo.working', { service: name }));
    const local = await prepare(host, scope, format, node, title);
    if (!local || !node) return void showToast({ message: t('accounts.sendTo.empty'), tone: 'danger' });
    try {
      const copy = await sendFile(destination, local, {
        node,
        scope,
        format,
        folder: folder.id,
        folderName: folder.name,
      });
      const message = t('accounts.sendTo.done', { name: copy.name, service: name, folder: folder.name });
      showToast({ message });
      announce(message);
    } finally {
      await host.tempRemove(local.file).catch(() => undefined);
    }
  });
}

/** The copies of the page that is open, or of the section and notebook it sits in. */
async function copiesHere(): Promise<SentCopy[]> {
  const where = whereNow();
  const nodes = [where.page, where.section, where.notebook].filter((one): one is NodeId => one !== null);
  return copiesOf(await loadCopies(), nodes).filter((copy) => copy.format !== 'png');
}

/** Sends the node again over its copy. */
export async function updateCopy(copy: SentCopy, quiet = false): Promise<void> {
  const name = NAMES[copy.service];
  if (!(await isConnected(CONNECTOR[copy.service]))) return quiet ? undefined : tellNotConnected(name);
  const work = async () => {
    const host = accountsHost();
    const title = await titleOf(copy.node as NodeId, copy.name);
    if (!quiet) announce(t('accounts.sendTo.updating', { name: copy.name }));
    const local = await prepare(host, copy.scope, copy.format, copy.node as NodeId, title);
    if (!local) return void (quiet || showToast({ message: t('accounts.sendTo.empty'), tone: 'danger' }));
    try {
      const updated = await sendFile(destinationFor(copy.service, host), local, {
        node: copy.node,
        scope: copy.scope,
        format: copy.format,
        folder: null,
        folderName: copy.folder,
        replace: copy.remote,
      });
      if (!quiet) {
        const message = t('accounts.sendTo.updated', { name: updated.name, service: name });
        showToast({ message });
        announce(message);
      }
    } finally {
      await host.tempRemove(local.file).catch(() => undefined);
    }
  };
  if (quiet) await work();
  else await attempt(name, work);
}

/** Update the copy: the page's copy, or a choice when it, its section, and its notebook have several. */
export async function updateHere(): Promise<void> {
  const copies = await copiesHere();
  if (copies.length === 0) return void showToast({ message: t('accounts.sendTo.noCopy') });
  const copy =
    copies.length === 1
      ? copies[0]
      : await pickOne<SentCopy>({
          title: t('accounts.sendTo.update.title'),
          confirmLabel: t('accounts.sendTo.update.confirm'),
          choices: copies.map((one) => ({
            id: `${one.service}:${one.remote}`,
            label: one.name,
            detail: t('accounts.sendTo.update.detail', { service: NAMES[one.service], folder: one.folder }),
            value: one,
          })),
        });
  if (copy) await updateCopy(copy);
}

const offered = new Set<string>();

/**
 * After a page that was sent is opened and has changed since, offers to update the copy. Quiet: a toast with one button,
 * once for a page until the app restarts. Nothing is sent unless the person presses it.
 */
export async function offerUpdate(page: string, modified: string): Promise<void> {
  if (offered.has(page)) return;
  const copy = (await loadCopies()).find(
    (one) => one.node === page && one.scope === 'page' && one.format !== 'png' && changedSince(one, modified),
  );
  if (!copy) return;
  offered.add(page);
  showToast({
    message: t('accounts.sendTo.offer', { service: NAMES[copy.service] }),
    action: {
      label: t('accounts.sendTo.offerAction', { service: NAMES[copy.service] }),
      run: () => void updateCopy(copy),
    },
  });
}

export const resetOffers = (): void => offered.clear();

const SYNCED: readonly SendService[] = ['dropbox', 'box', 'webdav'];

/**
 * Brings every Dropbox, Box, and WebDAV copy up to date in one go: a page's copy when the page changed since it was
 * sent, a section's or notebook's copy always (their own times don't follow their pages). Each is sent over its copy,
 * so nothing new appears in the folder. Quiet when nothing needs it.
 */
export async function syncCopies(): Promise<number> {
  const notes = commandContext('palette').notes;
  const copies = await loadCopies();
  const times = new Map<string, string>();
  for (const copy of copies) {
    if (copy.scope !== 'page' || times.has(copy.node)) continue;
    const node = await notes.get(copy.node as NodeId);
    if (node) times.set(copy.node, node.modified);
  }
  const due = copiesDue(copies, SYNCED, (node) => times.get(node) ?? null);
  if (due.length === 0) {
    showToast({ message: t('accounts.sendTo.sync.nothing') });
    return 0;
  }
  for (const copy of due) await updateCopy(copy);
  const message = t('accounts.sendTo.sync.done', { count: due.length });
  showToast({ message });
  announce(message);
  return due.length;
}

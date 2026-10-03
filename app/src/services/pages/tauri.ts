// The page service over Phase 3's core (ARCHITECTURE.md section 10.1; owner after WP0: WP2). Each call maps one to
// one onto a core command through the client in app/src/core/, which keeps one request in flight per page. The
// core's `core:*` events become frames, external changes, and read-only notices for the page they name.
import type { CoreClient, DecodedEnvelope, FrameInfo } from '../../core/client';
import type { ImagesClient, IpcError } from '../../platform/types';
import { PageServiceError } from './types';
import type {
  AppliedFrame,
  AssetJson,
  BlockId,
  BlockJson,
  ExternalChange,
  OpenPage,
  PageErrorCode,
  PageHistory,
  PageJson,
  PageService,
  ReadOnlyInfo,
  TxnAck,
  VersionInfo,
} from './types';

function pageError(error: unknown): PageServiceError {
  if (error instanceof PageServiceError) return error;
  const ipc = error as Partial<IpcError>;
  return new PageServiceError((ipc.code ?? 'invalid') as PageErrorCode, ipc.message ?? String(error));
}

const rejectAs = (error: unknown) => Promise.reject(pageError(error));

/** The core's page.json, with every field the page view reads. Unknown fields stay. */
export function toPageJson(raw: Record<string, unknown>, id: string): PageJson {
  return {
    ...raw,
    id: typeof raw.id === 'string' ? raw.id : id,
    title: typeof raw.title === 'string' ? raw.title : '',
    created: String(raw.created ?? ''),
    modified: String(raw.modified ?? ''),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    view: (raw.view as PageJson['view']) ?? {},
    blocks: Array.isArray(raw.blocks) ? (raw.blocks as BlockJson[]) : [],
    assets: (raw.assets as PageJson['assets']) ?? {},
  };
}

export function toFrame(info: FrameInfo): AppliedFrame {
  const assets: Record<string, AssetJson | null> = {};
  for (const id of info.changes.assetsChanged) assets[id] = null;
  for (const { id, ...asset } of info.assets) assets[id] = asset as unknown as AssetJson;
  const fields = info.changes.pageFields;
  return {
    blocks: info.blocks as unknown as BlockJson[],
    removed: info.changes.blocksRemoved,
    page: fields
      ? { title: info.title ?? undefined, view: info.view ?? undefined, tags: info.tags ?? undefined }
      : null,
    assets,
    ui: (info.ui as AppliedFrame['ui']) ?? null,
    canUndo: info.canUndo,
    canRedo: info.canRedo,
  };
}

/** What the core says changed, as `core:txn-applied` carries it (crates/core/src/ops/mod.rs, AppliedChanges). */
interface Changes {
  pageFields: boolean;
  blocksChanged: BlockId[];
  blocksRemoved: BlockId[];
  assetsChanged: string[];
}

/** A frame of another client's change, from the page as the core now holds it. */
export function frameFromPage(page: PageJson, changes: Changes, state: { canUndo: boolean; canRedo: boolean }) {
  const changed = new Set(changes.blocksChanged);
  const assets: Record<string, AssetJson | null> = {};
  for (const id of changes.assetsChanged) assets[id] = page.assets[id] ?? null;
  const frame: AppliedFrame = {
    blocks: page.blocks.filter((block) => changed.has(block.id)),
    removed: changes.blocksRemoved,
    page: changes.pageFields ? { title: page.title, view: page.view, tags: page.tags } : null,
    assets,
    ui: null,
    ...state,
  };
  return frame;
}

/** The read-only notice and the action Phase 3 offers for a reason the core names (core plan 9.6 and 17.6). */
export function readOnlyInfo(reason: string): ReadOnlyInfo {
  const action = reason === 'damagedInk' ? 'repairInk' : reason === 'readOnlyFile' ? 'makeEditable' : null;
  return { reason, action };
}

const kindOf = (value: unknown) =>
  typeof value === 'string' ? value : String((value as { kind?: unknown } | null)?.kind ?? '');

/** A saved version as the core lists it (crates/core/src/model/history.rs, VersionEntry). */
export function toVersionInfo(raw: Record<string, unknown>): VersionInfo {
  const device = raw.device as { label?: unknown } | string | undefined;
  return {
    revision: String(raw.revision ?? ''),
    savedAt: String(raw.savedAt ?? ''),
    reason: kindOf(raw.reason),
    device: typeof device === 'object' ? String(device?.label ?? '') : String(device ?? ''),
    name: typeof raw.name === 'string' ? raw.name : null,
    keep: raw.keep === true,
  };
}

function listeners<T>() {
  const set = new Set<(value: T) => void>();
  return {
    get size() {
      return set.size;
    },
    emit: (value: T) => set.forEach((listener) => listener(value)),
    add(listener: (value: T) => void) {
      set.add(listener);
      return () => void set.delete(listener);
    },
  };
}

interface Session {
  page: string;
  client: string;
  core: CoreClient;
  nextSeq(): number;
  reread(): Promise<{ page: PageJson; envelope: DecodedEnvelope }>;
  external: ReturnType<typeof listeners<ExternalChange>>;
}

function history(session: Session): PageHistory {
  const { core, page, client } = session;
  return {
    list: () => core.historyList(page, client).then((versions) => versions.map(toVersionInfo), rejectAs),
    open: (revision) =>
      core.historyOpen(page, client, revision).then((envelope) => toPageJson(envelope.page, page), rejectAs),
    async restore(revision, asCopy) {
      const result = await core.historyRestore(page, client, revision, asCopy).catch(rejectAs);
      if (result.kind === 'copied') return { page: String(result.page), asCopy: true };
      // The page now holds the version, so the view reopens it.
      session.external.emit({ action: 'reloaded' });
      return { page, asCopy: false };
    },
    async restoreBlocks(revision, blocks) {
      const request = { page, client, clientSeq: session.nextSeq(), revision, blocks: [...blocks] };
      const ack: TxnAck = await core.historyRestoreBlocks(request).catch(rejectAs);
      const { page: held } = await session.reread();
      const restored = held.blocks.filter((block) => blocks.includes(block.id));
      const present = new Set(restored.map((block) => block.id));
      const changes = {
        pageFields: false,
        blocksChanged: [...present],
        blocksRemoved: blocks.filter((id) => !present.has(id)),
        assetsChanged: restored.flatMap((block) => (typeof block.data.asset === 'string' ? [block.data.asset] : [])),
      };
      return frameFromPage(held, changes, ack);
    },
    name: (revision, name, keep) => core.historyName(page, client, revision, name, keep).catch(rejectAs),
  };
}

/** Hears the core's events for this page and client, while anything listens. */
function events(session: Session, frames: ReturnType<typeof listeners<AppliedFrame>>) {
  const readOnly = listeners<ReadOnlyInfo | null>();
  const stops: (() => void)[] = [];
  const mine = (payload: unknown) => (payload as { page?: unknown } | null)?.page === session.page;
  const start = () => {
    if (stops.length > 0) return;
    stops.push(
      session.core.onEvent('core:txn-applied', (payload) => {
        const event = payload as { page: string; sourceClient: string; changes: Changes };
        if (!mine(payload) || event.sourceClient === session.client || frames.size === 0) return;
        void session
          .reread()
          .then(({ page, envelope }) => frames.emit(frameFromPage(page, event.changes, envelope.session)));
      }),
      session.core.onEvent('core:external-change', (payload) => {
        if (mine(payload))
          session.external.emit({
            action: kindOf((payload as { action?: unknown }).action) as ExternalChange['action'],
          });
      }),
      session.core.onEvent('core:read-only', (payload) => {
        if (mine(payload)) readOnly.emit(readOnlyInfo(kindOf((payload as { reason?: unknown }).reason)));
      }),
    );
  };
  const listen =
    <T>(set: ReturnType<typeof listeners<T>>) =>
    (listener: (value: T) => void) => {
      start();
      return set.add(listener);
    };
  return {
    onFrame: listen(frames),
    onExternal: listen(session.external),
    onReadOnly: listen(readOnly),
    stop: () => stops.splice(0).forEach((stop) => stop()),
  };
}

export function createTauriPageService(client: CoreClient, images: ImagesClient): PageService {
  let clients = 0;
  return {
    async open(pageId, { viewport }): Promise<OpenPage> {
      const name = `main-${++clients}`;
      const envelope = await client.pageOpen(pageId, name, viewport).catch(rejectAs);
      let seq = envelope.session.clientSeq;
      const session: Session = {
        page: pageId,
        client: name,
        core: client,
        nextSeq: () => ++seq,
        async reread() {
          const again = await client.pageOpen(pageId, name, null);
          return { page: toPageJson(again.page, pageId), envelope: again };
        },
        external: listeners<ExternalChange>(),
      };
      const heard = events(session, listeners<AppliedFrame>());
      const frame = (info: FrameInfo | null) => (info ? toFrame(info) : null);
      return {
        id: pageId,
        client: name,
        initial: toPageJson(envelope.page, pageId),
        readOnly: envelope.readOnly ? readOnlyInfo(envelope.session.readOnly ?? 'readOnly') : null,
        // Phase 3's core takes spliceText (P3-10); an older core would refuse it as invalid.
        supportsSplice: true,
        send: (batch) =>
          client
            .pageApply({
              page: pageId,
              client: name,
              clientSeq: session.nextSeq(),
              coalesce: batch.coalesce ?? null,
              ui: batch.ui ?? null,
              edits: batch.edits,
            })
            .catch(rejectAs),
        undo: () => client.pageUndo(pageId, name).then(frame, rejectAs),
        redo: () => client.pageRedo(pageId, name).then(frame, rejectAs),
        saveNow: () => client.pageSaveNow(pageId).catch(rejectAs),
        importImage(source) {
          if (source.kind === 'bytes') return images.importBytes(pageId, source.bytes, source.name, source.mime);
          if (source.kind === 'url') return images.importUrl(pageId, source.url);
          return images.importClip(pageId, source.token);
        },
        // WebView2 reaches custom schemes as http://<scheme>.localhost (images/protocol.rs).
        assetUrl: (asset) => `http://opennote-asset.localhost/${pageId}/${asset}`,
        history: history(session),
        onFrame: heard.onFrame,
        onExternal: heard.onExternal,
        onReadOnly: heard.onReadOnly,
        close: () => {
          heard.stop();
          return client.pageClose(pageId, name).catch(rejectAs);
        },
      };
    },
  };
}

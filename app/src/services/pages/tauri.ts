// The page service over Phase 3's core (ARCHITECTURE.md section 10.1; owner after WP0: WP2). Each call maps one to
// one onto a core command through the client in app/src/core/, which keeps one request in flight per page.
// WP0 wires open, send, undo, redo, save, close, and image import; history and the core's events come with WP2
// and WP7, once the shell has those commands.
import type { CoreClient, FrameInfo } from '../../core/client';
import type { ImagesClient, IpcError } from '../../platform/types';
import { PageServiceError } from './types';
import type {
  AppliedFrame,
  AssetJson,
  BlockJson,
  OpenPage,
  PageErrorCode,
  PageHistory,
  PageJson,
  PageService,
} from './types';

function pageError(error: unknown): PageServiceError {
  if (error instanceof PageServiceError) return error;
  const ipc = error as Partial<IpcError>;
  return new PageServiceError((ipc.code ?? 'invalid') as PageErrorCode, ipc.message ?? String(error));
}

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

const later = (what: string) => () =>
  Promise.reject(new PageServiceError('notImplemented', `${what} needs a shell command that isn't built yet.`));

const noHistory: PageHistory = {
  list: later('Page history'),
  open: later('Opening a version'),
  restore: later('Restoring a version'),
  restoreBlocks: later('Restoring blocks'),
  name: later('Naming a version'),
};

const noEvents = () => () => undefined;

export function createTauriPageService(client: CoreClient, images: ImagesClient): PageService {
  let clients = 0;
  return {
    async open(pageId, { viewport }): Promise<OpenPage> {
      const name = `main-${++clients}`;
      const envelope = await client.pageOpen(pageId, name, viewport).catch((error: unknown) => {
        throw pageError(error);
      });
      let seq = envelope.session.clientSeq;
      const frame = (info: FrameInfo | null) => (info ? toFrame(info) : null);
      return {
        id: pageId,
        client: name,
        initial: toPageJson(envelope.page, pageId),
        readOnly: envelope.readOnly ? { reason: envelope.session.readOnly ?? 'readOnly', action: null } : null,
        supportsSplice: true,
        send: (batch) =>
          client
            .pageApply({
              page: pageId,
              client: name,
              clientSeq: ++seq,
              coalesce: batch.coalesce ?? null,
              ui: batch.ui ?? null,
              edits: batch.edits,
            })
            .catch((error: unknown) => {
              throw pageError(error);
            }),
        undo: () => client.pageUndo(pageId, name).then(frame, (error: unknown) => Promise.reject(pageError(error))),
        redo: () => client.pageRedo(pageId, name).then(frame, (error: unknown) => Promise.reject(pageError(error))),
        saveNow: () => client.pageSaveNow(pageId).catch((error: unknown) => Promise.reject(pageError(error))),
        importImage(source) {
          if (source.kind === 'bytes') return images.importBytes(pageId, source.bytes, source.name, source.mime);
          if (source.kind === 'url') return images.importUrl(pageId, source.url);
          return images.importClip(pageId, source.token);
        },
        assetUrl: (asset) => `opennote-asset://localhost/${pageId}/${asset}`,
        history: noHistory,
        onFrame: noEvents,
        onExternal: noEvents,
        onReadOnly: noEvents,
        close: () => client.pageClose(pageId, name).catch((error: unknown) => Promise.reject(pageError(error))),
      };
    },
  };
}

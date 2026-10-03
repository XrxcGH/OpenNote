// Page history in memory (owner: WP2): a version for the page as it was first loaded and one for each "save now",
// as Phase 3 keeps one per save (core plan 8). Restoring a version, or some of its blocks, is one undo step.
import { newId } from '../../../editor/ids';
import { PageServiceError } from '../types';
import type { BlockId, PageJson, VersionInfo } from '../types';
import { sortBlocks } from './apply';

export interface Version {
  info: VersionInfo;
  page: PageJson;
}

export interface Versions {
  save(page: PageJson, reason: string): VersionInfo;
  list(): VersionInfo[];
  get(revision: string): Version;
  name(revision: string, name: string | null, keep: boolean): void;
}

export function createVersions(): Versions {
  const versions: Version[] = [];
  const get = (revision: string) => {
    const found = versions.find((version) => version.info.revision === revision);
    if (!found) throw new PageServiceError('notFound', `The page has no version ${revision}.`);
    return found;
  };
  return {
    save(page, reason) {
      const info: VersionInfo = {
        revision: newId(),
        savedAt: new Date().toISOString(),
        reason,
        device: 'This device',
        name: null,
        keep: false,
      };
      versions.push({ info, page: structuredClone(page) });
      return { ...info };
    },
    list: () => versions.map((version) => ({ ...version.info })).reverse(),
    get,
    name(revision, name, keep) {
      const version = get(revision);
      version.info = { ...version.info, name, keep };
    },
  };
}

/** `current` with `blocks` as they were in `version`: changed back, put back, or removed if the version lacks them. */
export function withBlocksFrom(current: PageJson, version: PageJson, blocks: readonly BlockId[]): PageJson {
  const next = structuredClone(current);
  next.blocks = next.blocks.filter((block) => !blocks.includes(block.id));
  for (const block of version.blocks) {
    if (blocks.includes(block.id)) next.blocks.push(structuredClone(block));
  }
  for (const block of next.blocks) {
    const image = block.data.asset;
    if (typeof image === 'string' && !next.assets[image] && version.assets[image]) {
      next.assets[image] = structuredClone(version.assets[image]);
    }
  }
  sortBlocks(next);
  return next;
}

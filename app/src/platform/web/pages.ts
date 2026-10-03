// The web platform's pages (owner after WP0: WP2): the memory page service. A page the fixtures don't hold opens
// empty, or as the page fixture that the address names, such as ?fixture=sampler, so every page shows it. The
// pagesSent test hook lists what a page was sent, by default the page opened last.
import { isPageFixtureName, pageFixture } from '../../services/pages/fixtures';
import { createMemoryPageService } from '../../services/pages/memory';
import type { MemoryPageService } from '../../services/pages/memory';
import type { PageJson } from '../../services/pages/types';
import { registerTestHook } from './testHooks';

function emptyPage(id: string): PageJson {
  const now = new Date().toISOString();
  return { id, title: '', created: now, modified: now, tags: [], view: {}, blocks: [], assets: {} };
}

function fixtureFromAddress(): string | null {
  return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('fixture');
}

export function createWebPages(fixture: string | null = fixtureFromAddress()): MemoryPageService {
  const service = createMemoryPageService([], {
    missing: (id) =>
      isPageFixtureName(fixture) ? { ...structuredClone(pageFixture(fixture).page), id } : emptyPage(id),
  });
  let last: string | null = null;
  registerTestHook('pagesSent', (page?: string) => service.sent(page ?? last ?? ''));
  return {
    ...service,
    open(pageId, options) {
      last = pageId;
      return service.open(pageId, options);
    },
  };
}

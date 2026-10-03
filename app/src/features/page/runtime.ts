// The platform clients the page feature uses, set once at start-up (owner after WP0: WP3).
import type { PagesClient, Platform } from '../../platform/types';

let pages: PagesClient | null = null;

export function installPages(platform: Pick<Platform, 'pages'>): () => void {
  pages = platform.pages;
  return () => {
    pages = null;
  };
}

export function pagesClient(): PagesClient {
  if (!pages) throw new Error('The page view needs installPages(platform) first.');
  return pages;
}

// Search and linking (Phase 8). Other features reach it through here: start-up installs it, and the page view
// mounts the link layer and the linked pages pane from their own files.
export { installSearch } from './install';
export { openSearchPanel } from './open';
export { SEARCH_FLAGS } from './flags';
export { locationOfPage, openPage } from './locate';
export { maybeSearchClient } from './client';

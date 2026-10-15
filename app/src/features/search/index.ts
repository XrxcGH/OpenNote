// Search and linking (Phase 8). Other features reach it through here: start-up installs it, and the page view
// mounts the link layer and the linked pages pane from their own files.
export { installSearch } from './install';
export { openSearchPanel } from './open';
export { SEARCH_FLAGS } from './flags';
export { indexMediaText } from './media/indexer';
export { FIELD_TYPES, compareValues, displayValue, fieldNamed, readFields, viewPatch } from './properties/model';
export type { Field, FieldType } from './properties/model';
export { locationOfPage, openPage } from './locate';
export { openAndReveal } from './deeplink/jump';
export { otherLinkReaders } from './deeplink/install';
export { formatLink } from './deeplink/url';
export { maybeSearchClient, setSearchClient } from './client';
export { armedChange, recordChange, undoArmedChange } from './changeSet';
export { undoPageChanges } from './changeSet';
export type { PageChange } from './changeSet';
export { disarmChange } from './changeSet';

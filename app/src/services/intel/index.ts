// On-device intelligence from the interface's side (Phase 12): text in images, handwriting, summaries, keywords,
// and read aloud. This is the typed client only. The screens that use it, and the Tauri commands behind its
// transport, come after the editor lands. See crates/intel/README.md for what the wiring needs.

export { createIntelClient } from './client';
export type { IntelClient, SpokenText } from './client';
export { IntelClientError, isIntelError, toIntelError } from './errors';
export { createFakeIntelTransport } from './fake';
export type { FakeIntelOptions, FakeIntelTransport } from './fake';
export { fromImageData } from './image';
export { pageSpan, wordAt } from './readAloud';
export type { ReadAloudChunk, ReadAloudSession } from './readAloud';
export type { IntelCommands, IntelTransport, RawBytes } from './transport';
export { FEATURES } from './types';
export type * from './types';

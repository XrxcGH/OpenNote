// The Phase 2 in-memory notes service. services/notes/index.ts chooses it until Phase 3's storage takes over.

export { createMemoryNotesService } from './service';
export type { MemoryNotesOptions, MemoryNotesService } from './service';

// Globals the page reads or writes before and outside React.

interface OpenNoteDevOptions {
  fixture?: string;
  pseudo?: boolean;
}

interface Window {
  /** The boot payload Rust injects before any page script runs. */
  __OPENNOTE_BOOT__?: unknown;
  /** Development options that a test can set before the page loads. */
  __OPENNOTE_DEV__?: OpenNoteDevOptions;
  /** Test hooks, only in `vite build --mode test` builds. */
  __OPENNOTE_TEST__?: Record<string, (...args: never[]) => unknown>;
  /** The component gallery's entries, for the screenshot and axe tests to walk (app/src/dev/gallery). */
  __OPENNOTE_GALLERY__?: { id: string; title: string; group: string }[];
}

interface ImportMetaEnv {
  /** The platform this build talks to, set by app/vite.config.ts. */
  readonly VITE_PLATFORM: 'tauri' | 'web';
}

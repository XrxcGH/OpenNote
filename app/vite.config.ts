import { defineConfig } from 'vite';
import type { ConfigEnv, UserConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { phosphorWeights } from './scripts/phosphor-weights.ts';

export type PlatformKind = 'tauri' | 'web';

/**
 * Which platform the build talks to (ARCHITECTURE.md section 6.1), chosen at build time so the production
 * bundle holds no web fakes. `vite build` ships the Tauri platform. Test builds and a plain `vite` dev server use
 * the web platform. Tauri sets TAURI_ENV_PLATFORM for its dev server, so `npm start` gets the Tauri platform.
 * OPENNOTE_PLATFORM overrides the choice.
 */
export function platformFor({ mode, command }: Pick<ConfigEnv, 'mode' | 'command'>): PlatformKind {
  const forced = process.env.OPENNOTE_PLATFORM;
  if (forced === 'tauri' || forced === 'web') return forced;
  if (mode === 'test') return 'web';
  if (command === 'build') return 'tauri';
  return process.env.TAURI_ENV_PLATFORM ? 'tauri' : 'web';
}

export function viteConfig(env: Pick<ConfigEnv, 'mode' | 'command'>): UserConfig {
  const platform = platformFor(env);
  return {
    root: import.meta.dirname,
    plugins: [react(), phosphorWeights()],
    clearScreen: false,
    define: { 'import.meta.env.VITE_PLATFORM': JSON.stringify(platform) },
    // Tauri expects a fixed dev server port and serves the built files from app/dist.
    server: { port: 1420, strictPort: true },
    preview: { host: '127.0.0.1', port: 4173, strictPort: true },
    build: {
      // Test builds go to their own folder, so the app never embeds the web platform by accident.
      outDir: env.mode === 'test' ? 'dist-test' : 'dist',
      emptyOutDir: true,
      // WebView2 130 is the minimum runtime (ARCHITECTURE.md section 8.6).
      target: 'chrome130',
      // check-bundle.ts reads the manifest to find the start-up chunks.
      manifest: true,
    },
  };
}

export default defineConfig((env) => viteConfig(env));

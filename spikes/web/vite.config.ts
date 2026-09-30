import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Builds the spike pages into spikes/web/dist, which the spike harness serves at http://spike.localhost/.
const page = (name: string) => resolve(import.meta.dirname, `${name}.html`);

export default defineConfig({
  root: import.meta.dirname,
  base: './',
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { input: { ink: page('ink'), text: page('text'), pdf: page('pdf') } },
  },
});

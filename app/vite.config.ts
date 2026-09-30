import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Tauri expects a fixed dev server port and serves the built files from app/dist.
export default defineConfig({
  root: import.meta.dirname,
  plugins: [react()],
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
  test: { environment: 'jsdom', include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'] },
});

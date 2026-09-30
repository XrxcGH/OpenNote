// The build picks the platform in app/vite.config.ts. Production builds ship Tauri, and so does Tauri's own dev
// server. Test builds use the web platform, as does a plain dev server.

import { afterEach, describe, expect, it } from 'vitest';
import { platformFor } from '../vite.config.ts';

const saved = { tauri: process.env.TAURI_ENV_PLATFORM, forced: process.env.OPENNOTE_PLATFORM };

afterEach(() => {
  process.env.TAURI_ENV_PLATFORM = saved.tauri;
  process.env.OPENNOTE_PLATFORM = saved.forced;
  if (saved.tauri === undefined) delete process.env.TAURI_ENV_PLATFORM;
  if (saved.forced === undefined) delete process.env.OPENNOTE_PLATFORM;
});

describe('platformFor', () => {
  it('ships the Tauri platform in production builds', () => {
    delete process.env.TAURI_ENV_PLATFORM;
    expect(platformFor({ mode: 'production', command: 'build' })).toBe('tauri');
  });

  it('uses the web platform in test builds and a plain dev server', () => {
    delete process.env.TAURI_ENV_PLATFORM;
    expect(platformFor({ mode: 'test', command: 'build' })).toBe('web');
    expect(platformFor({ mode: 'development', command: 'serve' })).toBe('web');
  });

  it("uses the Tauri platform under Tauri's dev server, and honors an override", () => {
    process.env.TAURI_ENV_PLATFORM = 'windows';
    expect(platformFor({ mode: 'development', command: 'serve' })).toBe('tauri');
    process.env.OPENNOTE_PLATFORM = 'web';
    expect(platformFor({ mode: 'production', command: 'build' })).toBe('web');
  });
});

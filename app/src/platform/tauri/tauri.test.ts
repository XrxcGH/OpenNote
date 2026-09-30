// @vitest-environment jsdom
// The Tauri platform against Tauri's mockIPC: the command names, the argument shapes Rust reads (camelCase, as
// Tauri maps them to the Rust parameters), and the event names.

import { emit } from '@tauri-apps/api/event';
import { clearMocks, mockIPC } from '@tauri-apps/api/mocks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultBootData } from '../../boot/defaults';
import type { Platform } from '../types';
import { createTauriPlatform } from './index';

type Call = { command: string; args: unknown };

let calls: Call[];
let answers: Record<string, unknown>;
let platform: Platform;

beforeEach(() => {
  calls = [];
  answers = {};
  mockIPC(
    (command, args) => {
      calls.push({ command, args });
      const answer = answers[command];
      if (answer instanceof Error) throw answer;
      if (typeof answer === 'object' && answer !== null && 'code' in answer) throw answer;
      return answer ?? null;
    },
    { shouldMockEvents: true },
  );
  platform = createTauriPlatform(defaultBootData());
});

afterEach(() => clearMocks());

const last = () => calls[calls.length - 1];
const settle = () => vi.waitFor(() => undefined);

describe('commands', () => {
  it('sends settings patches and resets with the names Rust reads', async () => {
    answers['settings_update'] = defaultBootData().settings;
    await platform.settings.update({ appearance: { theme: 'dark' } });
    expect(last()).toEqual({ command: 'settings_update', args: { patch: { appearance: { theme: 'dark' } } } });
    await platform.settings.reset('appearance');
    expect(last()).toEqual({ command: 'settings_reset', args: { section: 'appearance' } });
  });

  it('sends device state and flushes it', async () => {
    platform.state.update({ expanded: ['a'] });
    await settle();
    expect(last()).toEqual({ command: 'state_update', args: { patch: { expanded: ['a'] } } });
    await platform.state.flush();
    expect(last()).toEqual({ command: 'state_flush', args: {} });
  });

  it('sends window commands', async () => {
    platform.window.minimize();
    platform.window.toggleMaximize();
    platform.window.close();
    platform.window.setTitle('Set up OpenNote');
    platform.window.showSystemMenu({ x: 4, y: 8 });
    platform.window.showSystemMenu(null);
    platform.window.setFrameTheme('dark');
    platform.window.setCaptionLayout(null);
    await settle();
    expect(calls).toEqual([
      { command: 'window_minimize', args: {} },
      { command: 'window_toggle_maximize', args: {} },
      { command: 'window_close', args: {} },
      { command: 'window_set_title', args: { title: 'Set up OpenNote' } },
      { command: 'window_show_system_menu', args: { at: { x: 4, y: 8 } } },
      { command: 'window_show_system_menu', args: { at: null } },
      { command: 'window_set_frame_theme', args: { theme: 'dark' } },
      { command: 'window_set_caption_layout', args: { layout: null } },
    ]);
  });

  it('sends the lifecycle calls', async () => {
    const timings = { firstPaintEpochMs: 1, pageReadyEpochMs: 2, pageId: null };
    platform.lifecycle.firstPaint();
    platform.lifecycle.ready(timings);
    platform.lifecycle.exitReady({ ok: false, reason: 'errors.commandFailed' });
    await settle();
    expect(calls).toEqual([
      { command: 'app_first_paint', args: {} },
      { command: 'app_ready', args: { timings } },
      { command: 'app_exit_ready', args: { result: { ok: false, reason: 'errors.commandFailed' } } },
    ]);
  });

  it('sends the install and shell commands, links included', async () => {
    await platform.install.status();
    await platform.install.pickNotesFolder(null);
    await platform.install.checkNotesFolder('C:\\Notes');
    await platform.install.moveToUserPrograms();
    await platform.shell.openExternal({ kind: 'folder', which: 'logs' });
    await platform.shell.openExternal({ kind: 'link', url: 'https://example.com/' });
    await platform.shell.openExternal({ kind: 'windowsSettings', page: 'speech' });
    expect(calls).toEqual([
      { command: 'install_status', args: {} },
      { command: 'install_pick_folder', args: { initial: null } },
      { command: 'install_check_folder', args: { path: 'C:\\Notes' } },
      { command: 'install_move_to_user_programs', args: {} },
      { command: 'shell_open_external', args: { target: { kind: 'folder', which: 'logs' } } },
      { command: 'shell_open_external', args: { target: { kind: 'link', url: 'https://example.com/' } } },
      { command: 'shell_open_external', args: { target: { kind: 'windowsSettings', page: 'speech' } } },
    ]);
  });

  it('sends the notes snapshot, logs, and perf marks', async () => {
    await platform.notesSnapshot?.load();
    await platform.notesSnapshot?.save('{}');
    expect(calls).toEqual([
      { command: 'notes_snapshot_load', args: {} },
      { command: 'notes_snapshot_save', args: { json: '{}' } },
    ]);
    calls.length = 0;
    platform.log('error', 'It broke.');
    platform.perf.mark('firstPaint', 'dark');
    platform.perf.mark('shellReady');
    await settle();
    expect(calls[0]).toEqual({ command: 'log_write', args: { level: 'error', message: 'It broke.' } });
    expect(calls[1]?.command).toBe('perf_mark');
    expect(calls[1]?.args).toMatchObject({ name: 'firstPaint', detail: 'dark' });
    expect(calls[2]?.args).toMatchObject({ name: 'shellReady', detail: null });
  });
});

describe('errors', () => {
  it('rejects with the IpcError Rust sent', async () => {
    answers['settings_update'] = { code: 'invalid', message: 'No.', field: 'appearance.textSize' };
    await expect(platform.settings.update({})).rejects.toEqual({
      code: 'invalid',
      message: 'No.',
      field: 'appearance.textSize',
    });
  });

  it('reads a command the shell does not have as notImplemented', async () => {
    answers['install_status'] = new Error('command install_status not found');
    await expect(platform.install.status()).rejects.toMatchObject({ code: 'notImplemented' });
  });

  it('rejects the clients of later phases as notImplemented, and reports no dictation', async () => {
    await expect(platform.pages.load('p1')).rejects.toMatchObject({ code: 'notImplemented' });
    await expect(platform.spelling.suggest('teh', 'en-US')).rejects.toMatchObject({ code: 'notImplemented' });
    await expect(platform.clipboard.readText()).rejects.toMatchObject({ code: 'notImplemented' });
    await expect(platform.images.add(new Blob())).rejects.toMatchObject({ code: 'notImplemented' });
    await expect(platform.speech.available('en-US')).resolves.toBe(false);
  });
});

describe('events', () => {
  it('hears the events Rust emits, by name', async () => {
    const os = vi.fn();
    const maximized = vi.fn();
    const forwarded = vi.fn();
    const beforeExit = vi.fn();
    const settings = vi.fn();
    platform.os.onChange(os);
    platform.window.onMaximizedChange(maximized);
    platform.window.onForwardedArgs(forwarded);
    platform.lifecycle.onBeforeExit(beforeExit);
    platform.settings.onChange(settings);
    await settle();
    const appearance = { ...defaultBootData().os, dark: true, zoom: 1.5 };
    await emit('os://appearance-changed', appearance);
    await emit('window://maximized', true);
    await emit('window://forwarded-args', ['C:\\a.txt']);
    await emit('app://before-exit', 'moveApp');
    await emit('settings://changed', { settings: defaultBootData().settings, origin: 'main' });
    await vi.waitFor(() => expect(settings).toHaveBeenCalledTimes(1));
    expect(os).toHaveBeenCalledWith(appearance);
    expect(platform.os.current()).toEqual(appearance);
    expect(maximized).toHaveBeenCalledWith(true);
    expect(forwarded).toHaveBeenCalledWith(['C:\\a.txt']);
    expect(beforeExit).toHaveBeenCalledWith('moveApp');
    expect(settings).toHaveBeenCalledWith(defaultBootData().settings, 'main');
  });
});

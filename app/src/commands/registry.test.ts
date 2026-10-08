// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

const toasts = vi.hoisted(() => [] as { message: string; tone?: string }[]);
vi.mock('../ui/toast', () => ({ showToast: (toast: { message: string; tone?: string }) => void toasts.push(toast) }));

import type { Platform } from '../platform/types';
import { commands } from '../registries';
import type { NotesService } from '../services/notes/types';
import { t } from '../strings/t';
import { configureCommands, executeCommand } from './registry';
import type { CommandDef, CommandId } from './types';

describe('executeCommand', () => {
  it('tells the person when a command fails, as Insert mind map did in Beta 4, and logs why', async () => {
    const log = vi.fn();
    configureCommands({ platform: { log } as unknown as Platform, notes: {} as NotesService });
    const id = 'test.fails' as CommandId;
    const def = {
      id,
      title: 'errors.commandFailed',
      run: () => Promise.reject(new Error('the block type "mindmap" is unknown')),
    } as unknown as CommandDef;
    const stop = commands.register(def);
    expect(await executeCommand(id)).toBe(false);
    expect(toasts).toEqual([{ message: t('errors.commandFailed'), tone: 'danger' }]);
    expect(log).toHaveBeenCalledWith('error', expect.stringContaining('is unknown'));
    stop();
  });
});

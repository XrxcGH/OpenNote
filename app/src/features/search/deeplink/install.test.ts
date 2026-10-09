// T3-14: the forwarded-args listener is subscribed during install, and both the forwarded and the first-launch link open the page.
import { describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../app/flags';
import type { Platform } from '../../../platform/types';
import type { NotesService } from '../../../services/notes/types';

const { openAndReveal } = vi.hoisted(() => ({ openAndReveal: vi.fn(() => Promise.resolve(true)) }));
vi.mock('./jump', () => ({ openAndReveal }));
vi.mock('../../../ui', () => ({ showToast: vi.fn() }));

initFlags('dev', { 'search.paragraphLinks': true });
const notes = {} as NotesService;
const { installDeepLinks } = await import('./install');
const { formatLink } = await import('./url');

function platformWith(launch: string | null) {
  let forwarded: ((args: string[]) => void) | null = null;
  const platform = {
    window: {
      onForwardedArgs: (listener: (args: string[]) => void) => {
        forwarded = listener;
        return () => (forwarded = null);
      },
    },
    search: { extras: { launchLink: () => Promise.resolve(launch) } },
  } as unknown as Platform;
  return { platform, send: (args: string[]) => forwarded?.(args), listening: () => forwarded !== null };
}

describe('opennote:// launches', () => {
  it('listens as soon as it is installed and opens the page of a forwarded link', () => {
    openAndReveal.mockClear();
    const { platform, send, listening } = platformWith(null);
    const stop = installDeepLinks(platform, notes);
    expect(listening()).toBe(true);
    send(['OpenNote.exe', formatLink('page-1', 'block-2')]);
    expect(openAndReveal).toHaveBeenCalledWith(notes, 'page-1', 'block-2');
    send(['OpenNote.exe', '--flag']);
    expect(openAndReveal).toHaveBeenCalledTimes(1);
    stop();
  });

  it('opens the first launch link once the shell hands it over', async () => {
    openAndReveal.mockClear();
    const { platform } = platformWith(formatLink('page-9'));
    installDeepLinks(platform, notes)();
    await vi.waitFor(() => expect(openAndReveal).toHaveBeenCalledWith(notes, 'page-9', null));
  });
});

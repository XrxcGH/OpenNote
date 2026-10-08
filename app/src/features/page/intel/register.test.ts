// Start-up registers the on-device transcriber behind "Make a transcript" when transcription is built in.
import { describe, expect, it, vi } from 'vitest';
import { initFlags } from '../../../app/flags';
import { currentEngine } from '../audio/transcripts/engine';
import { installTestHost } from '../../intel/testing';

describe('page start-up', () => {
  it('registers the Whisper engine for Make a transcript', { timeout: 30_000 }, async () => {
    initFlags('dev');
    installTestHost();
    expect(currentEngine()).toBeNull();
    await import('./register');
    await vi.waitFor(() => expect(currentEngine()?.id).toBe('whisper'), { timeout: 20_000 });
  });
});

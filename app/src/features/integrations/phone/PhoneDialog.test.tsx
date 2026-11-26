// Insert > From phone on the fake host: the code and its fingerprint show, a photo that arrives is pasted onto the
// page, a closed session says why and offers a new code, and closing the dialog stops the listener.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectNoAxeViolations, renderApp } from '../../../test';
import { createFakeApi } from '../api/host';
import type { ApiHost, FakeApi } from '../api/host';
import { PhoneDialog } from './PhoneDialog';

let fake: FakeApi;
let calls: string[];
let host: ApiHost;
let photos: unknown[];
let state: string;

beforeEach(async () => {
  await renderApp();
  fake = createFakeApi();
  calls = [];
  photos = [];
  state = 'open';
  host = {
    listen: fake.host.listen,
    call: <T,>(method: string, args?: Record<string, unknown>) => {
      calls.push(method);
      if (method === 'phoneTake') return Promise.resolve(photos.splice(0) as T);
      if (method === 'phoneState') return Promise.resolve({ state } as T);
      return fake.host.call<T>(method, args);
    },
  };
});

afterEach(() => cleanup());

describe('From phone', () => {
  it('shows the code and the certificate fingerprint, and passes axe', async () => {
    render(<PhoneDialog onClose={() => undefined} pasteTarget={() => null} host={host} />);
    expect(await screen.findByRole('img', { name: /QR code/ })).toBeTruthy();
    expect(screen.getByText(/AB:AB:AB/)).toBeTruthy();
    expect(screen.getByText(/stops in 10 min/)).toBeTruthy();
    await expectNoAxeViolations(document.body);
  });

  it('pastes a photo that arrives onto the page', async () => {
    const target = new EventTarget();
    const pasted = vi.fn();
    target.addEventListener('paste', pasted);
    render(<PhoneDialog onClose={() => undefined} pasteTarget={() => target} host={host} />);
    await screen.findByRole('img', { name: /QR code/ });
    photos.push({ mime: 'image/png', width: 1, height: 1, data: btoa('png') });
    // The dialog listens once its effect has run; until then an event finds no one, as in the app.
    await waitFor(() => {
      fake.emit({ kind: 'phone', what: 'photo' });
      expect(pasted).toHaveBeenCalled();
    });
    expect(pasted).toHaveBeenCalledOnce();
    expect(await screen.findByText('Added 1 photo to the page.')).toBeTruthy();
  });

  it('names a scan cleanup command that is registered', async () => {
    const { commands } = await import('../../../registries');
    await import('../../pdf');
    expect(commands.get('pdf.scanCleanup')).toBeTruthy();
  });

  it('does not ask for scan cleanup when several photos arrive at once', async () => {
    const { commands } = await import('../../../registries');
    await import('../../pdf');
    const def = commands.get('pdf.scanCleanup')!;
    const run = vi.fn();
    const original = def.run;
    def.run = run;
    try {
      render(<PhoneDialog onClose={() => undefined} pasteTarget={() => new EventTarget()} host={host} />);
      await screen.findByRole('img', { name: /QR code/ });
      for (let one = 0; one < 2; one += 1) photos.push({ mime: 'image/png', width: 1, height: 1, data: btoa('png') });
      await waitFor(() => {
        fake.emit({ kind: 'phone', what: 'photo' });
        expect(screen.getByText('Added 2 photos to the page.')).toBeTruthy();
      });
      await new Promise((done) => setTimeout(done, 200));
      expect(run).not.toHaveBeenCalled();
    } finally {
      def.run = original;
    }
  });

  it('says why a closed session ended and offers a new code', async () => {
    render(<PhoneDialog onClose={() => undefined} pasteTarget={() => null} host={host} />);
    await screen.findByRole('img', { name: /QR code/ });
    state = 'tooManyTries';
    expect(await screen.findByText(/too many wrong codes/, undefined, { timeout: 5000 })).toBeTruthy();
    state = 'open';
    fireEvent.click(screen.getByRole('button', { name: 'Show a new code' }));
    await screen.findByRole('img', { name: /QR code/ });
    expect(calls.filter((method) => method === 'phoneStart')).toHaveLength(2);
  });

  it('stops the listener when it closes', async () => {
    const onClose = vi.fn();
    const view = render(<PhoneDialog onClose={onClose} pasteTarget={() => null} host={host} />);
    await screen.findByRole('img', { name: /QR code/ });
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalled();
    view.unmount();
    expect(calls).toContain('phoneStop');
  });
});

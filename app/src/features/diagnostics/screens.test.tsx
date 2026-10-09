// The diagnostics screens on the fake host: Privacy (Work offline, crash reports, the saved reports), Help (the
// self-check), Send feedback, the consent screen, and the safe start offer.

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { announcements, expectNoAxeViolations, renderApp } from '../../test';
import { createFakeDiagnostics, fakeReport, passingSelfCheck } from './fake';
import type { FakeDiagnostics, FakeState } from './fake';
import { hasModalLayer } from '../../state/layers';
import { accepted } from './consent';
import { ConsentDialog } from './ConsentDialog';
import { FeedbackDialog } from './FeedbackDialog';
import HelpSection from './HelpSection';
import { offerSafeStart } from './install';
import PrivacySection from './PrivacySection';
import { ReviewDialog } from './ReviewDialog';
import { SafeStartDialog } from './SafeStartDialog';
import { openSafeStart } from './safeStart';
import { changePrivacy, refreshPrivacy, safeModeStore } from './runtime';
import type { SelfCheck } from './types';

const passingCheck = (): SelfCheck => passingSelfCheck();

type Options = Partial<FakeState>;

async function setup(
  options: Options = {},
): Promise<{ app: Awaited<ReturnType<typeof renderApp>>; fake: FakeDiagnostics }> {
  const app = await renderApp();
  const fake = createFakeDiagnostics({ selfCheck: passingCheck(), ...options });
  Object.assign(app.platform, { diagnostics: fake.client });
  await refreshPrivacy(fake.client);
  return { app, fake };
}

const OPTED_IN: Options = {
  consent: accepted(1_790_000_000),
  endpoint: 'https://collector.example/v1',
  reports: [fakeReport('crash-2', 1_790_000_000), fakeReport('crash-1', 1_789_990_000)],
};

afterEach(() => {
  cleanup();
  changePrivacy({ workOffline: false, reportEndpoint: '', reportSentUnix: null });
});

describe('Privacy', () => {
  it('lists every kind of network use, and Work offline blocks them all in words', async () => {
    await setup();
    render(<PrivacySection />);
    const uses = screen.getByRole('region', { name: 'Network use' });
    expect(within(uses).getByText('Update checks')).toBeTruthy();
    expect(within(uses).getByText('Sending a crash report')).toBeTruthy();
    expect(within(uses).getByText('Saving a web image you paste')).toBeTruthy();
    expect(within(uses).queryByText('Blocked while you work offline.')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Work offline' }));
    await waitFor(() => {
      expect(within(uses).getAllByText('Blocked while you work offline.').length).toBeGreaterThanOrEqual(4);
    });
    expect(screen.getByRole('switch', { name: 'Work offline' }).getAttribute('aria-checked')).toBe('true');
    expect(announcements()).toContain('Working offline. OpenNote will not use the network.');
  });

  it('keeps Work offline in the host, and the title bar says so in text until it is turned off', async () => {
    const { fake } = await setup();
    render(<PrivacySection />);
    expect(screen.queryByRole('button', { name: 'Working offline' })).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: 'Work offline' }));
    await waitFor(() => expect(fake.state.workOffline).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Working offline' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Go online' }));
    await waitFor(() => expect(fake.state.workOffline).toBe(false));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Working offline' })).toBeNull());
  });

  it('turns crash reports on only after the consent screen, and a no keeps them off', async () => {
    const { fake } = await setup();
    render(<PrivacySection />);
    const toggle = () => screen.getByRole('switch', { name: 'Save crash reports on this computer' });
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle());
    const dialog = await screen.findByRole('dialog', { name: 'Save crash reports on this computer?' });
    expect(fake.state.consent.decision).toBe('unasked');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Turn on crash reports' }));
    await waitFor(() => expect(fake.state.consent.decision).toBe('accepted'));
    await waitFor(() => expect(toggle().getAttribute('aria-checked')).toBe('true'));
    expect(announcements()).toContain('Crash reports are on. They stay on this computer.');
    fireEvent.click(toggle());
    await waitFor(() => expect(fake.state.consent.decision).toBe('declined'));
    expect(toggle().getAttribute('aria-checked')).toBe('false');
  });

  it('lists the saved reports with Review and Delete, and deletes one', async () => {
    const { fake } = await setup(OPTED_IN);
    render(<PrivacySection />);
    expect(await screen.findByText('2 crash reports are saved on this computer.')).toBeTruthy();
    const rows = screen.getAllByRole('listitem').filter((row) => within(row).queryByRole('button', { name: /Review/ }));
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[0]!).getByRole('button', { name: /Delete/ }));
    await waitFor(() => expect(fake.state.reports).toHaveLength(1));
    expect(await screen.findByText('1 crash report is saved on this computer.')).toBeTruthy();
  });

  it('asks before it deletes every report', async () => {
    const { fake } = await setup(OPTED_IN);
    render(<PrivacySection />);
    fireEvent.click(await screen.findByRole('button', { name: 'Delete all' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete all crash reports?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(fake.state.reports).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }));
    fireEvent.click(
      within(await screen.findByRole('dialog', { name: 'Delete all crash reports?' })).getByRole('button', {
        name: 'Delete all',
      }),
    );
    await waitFor(() => expect(fake.state.reports).toHaveLength(0));
  });

  it('has no accessibility violations', async () => {
    await setup(OPTED_IN);
    const { container } = render(<PrivacySection />);
    await screen.findByText('2 crash reports are saved on this computer.');
    await expectNoAxeViolations(container);
  });
});

describe('Reviewing a crash report', () => {
  it('shows all of the text and sends it only after Send, with the digest of what was shown', async () => {
    const { fake } = await setup(OPTED_IN);
    render(<ReviewDialog id="crash-2" onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Review before sending' });
    const text = await within(dialog).findByRole('region', { name: 'Review before sending' });
    expect(text.textContent).toContain('0xc0000005');
    expect(within(dialog).getByText('It would be sent to https://collector.example/v1.')).toBeTruthy();
    expect(fake.sent).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send this report' }));
    await within(dialog).findByText('The report was sent. It is still saved here until you delete it.');
    expect(fake.sent).toEqual([text.textContent]);
  });

  it('says why a report cannot be sent when no address is set, and sends nothing', async () => {
    const { fake } = await setup({ ...OPTED_IN, endpoint: '' });
    render(<ReviewDialog id="crash-2" onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByText(/No address is set/);
    expect(within(dialog).queryByRole('button', { name: 'Send this report' })).toBeNull();
    expect(fake.sent).toHaveLength(0);
  });

  it('keeps the report and the text when a send fails, so it can be sent again', async () => {
    const { fake } = await setup(OPTED_IN);
    fake.state.failNextSend = true;
    render(<ReviewDialog id="crash-2" onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('region', { name: 'Review before sending' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send this report' }));
    await within(dialog).findByText("Couldn't send the report. It is still saved on this computer.");
    expect(fake.state.reports).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Send this report' }));
    await waitFor(() => expect(fake.sent).toHaveLength(1));
  });
});

describe('The consent screen', () => {
  it('has two buttons of the same weight and neither chosen, and shows the example only when asked', async () => {
    await setup();
    render(<ConsentDialog reason="first" onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Save crash reports on this computer?' });
    const buttons = ['Keep crash reports off', 'Turn on crash reports'].map((name) =>
      within(dialog).getByRole('button', { name }),
    );
    expect(buttons[0]!.className).toBe(buttons[1]!.className);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(buttons).not.toContain(document.activeElement);
    expect(within(dialog).queryByRole('region', { name: 'An example report' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'See an example report' }));
    const example = await within(dialog).findByRole('region', { name: 'An example report' });
    await waitFor(() => expect(example.textContent).toContain('opennote.exe'));
    await expectNoAxeViolations(dialog);
  });

  it('treats Escape as a no when it opened by itself', async () => {
    const { fake } = await setup();
    let closed = 0;
    render(<ConsentDialog reason="first" onClose={() => void closed++} />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(fake.state.consent.decision).toBe('declined'));
    await waitFor(() => expect(closed).toBe(1));
  });

  it('treats Escape as nothing when the person opened it from Settings', async () => {
    const { fake } = await setup();
    let closed = 0;
    render(<ConsentDialog reason="settings" onClose={() => void closed++} />);
    await screen.findByRole('dialog');
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(closed).toBe(1));
    expect(fake.calls).not.toContain('setConsent');
  });

  it('says that the answer is being asked again when the wording changed', async () => {
    await setup();
    render(<ConsentDialog reason="reworded" onClose={() => {}} />);
    expect(await screen.findByRole('dialog', { name: 'Crash reports have changed' })).toBeTruthy();
    expect(screen.getByText(/Your earlier answer no longer applies/)).toBeTruthy();
  });
});

describe('Help', () => {
  it('runs the self-check when it opens, and shows each status in words', async () => {
    const { fake } = await setup();
    render(<HelpSection />);
    await screen.findByText('Everything is in order.');
    expect(fake.calls.filter((call) => call === 'runSelfCheck')).toHaveLength(1);
    expect(screen.getByText('The notebook')).toBeTruthy();
    expect(screen.getAllByText('OK').length).toBeGreaterThan(3);
    expect(screen.getByText(/^Version /)).toBeTruthy();
  });

  it('names a problem in words and counts the files that have one', async () => {
    const check = passingCheck();
    check.items = check.items.map((item) =>
      item.id === 'notebookHealth'
        ? {
            ...item,
            status: 'fail',
            detail: {
              kind: 'health',
              files: 12,
              problemCount: 1,
              byCode: [{ code: 'segmentMissing', count: 1 }],
              problems: [{ code: 'segmentMissing', file: 'Biology/page-1.json' }],
              unsavedChanges: false,
              failed: null,
            },
          }
        : item,
    );
    await setup({ selfCheck: check });
    render(<HelpSection />);
    await screen.findByText('1 thing is wrong.');
    expect(screen.getByText('Problem')).toBeTruthy();
    expect(screen.getByText(/1 problem found in 12 files checked/)).toBeTruthy();
  });

  it('checks again when asked', async () => {
    const { fake } = await setup();
    render(<HelpSection />);
    await screen.findByText('Everything is in order.');
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(fake.calls.filter((call) => call === 'runSelfCheck')).toHaveLength(2));
  });

  it('has no accessibility violations', async () => {
    await setup();
    const { container } = render(<HelpSection />);
    await screen.findByText('Everything is in order.');
    await expectNoAxeViolations(container);
  });
});

describe('Send feedback', () => {
  it('shows the whole file before it can be saved, and saves exactly that text', async () => {
    const { fake } = await setup();
    render(<FeedbackDialog onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Send feedback' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'What happened?' }), {
      target: { value: 'The page jumped.' },
    });
    expect(within(dialog).queryByRole('button', { name: 'Save the file' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review the file' }));
    const review = await screen.findByRole('dialog', { name: 'Review before saving' });
    const text = within(review).getByRole('region', { name: 'The whole file' });
    expect(text.textContent).toContain('The page jumped.');
    expect(within(review).getByText('Recent log lines')).toBeTruthy();
    expect(within(review).getByText('Not included')).toBeTruthy();
    fireEvent.click(within(review).getByRole('button', { name: 'Save the file' }));
    await within(review).findByText(/^Saved as /);
    expect(fake.saved).toEqual([text.textContent]);
  });

  it('leaves crash reports out unless the person chooses them', async () => {
    const { fake } = await setup(OPTED_IN);
    render(<FeedbackDialog onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Send feedback' });
    const include = within(dialog).getByRole('switch', { name: 'Include saved crash reports' });
    expect(include.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review the file' }));
    const first = await screen.findByRole('region', { name: 'The whole file' });
    expect(first.textContent).not.toContain('crash-2');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Include saved crash reports' }));
    fireEvent.click(screen.getByRole('button', { name: 'Review the file' }));
    const second = await screen.findByRole('region', { name: 'The whole file' });
    await waitFor(() => expect(second.textContent).toContain('crash-2'));
    expect(fake.saved).toHaveLength(0);
  });

  it('stays on the text when the folder picker is closed, and when the save fails', async () => {
    const { fake } = await setup();
    render(<FeedbackDialog onClose={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Review the file' }));
    await screen.findByRole('region', { name: 'The whole file' });
    fake.state.cancelNextSave = true;
    fireEvent.click(screen.getByRole('button', { name: 'Save the file' }));
    await screen.findByText('Nothing was saved. Choose Save the file to pick a folder.');
    fake.state.failNextSave = true;
    fireEvent.click(screen.getByRole('button', { name: 'Save the file' }));
    await screen.findByText("Couldn't save the file. Pick another folder and try again.");
    fireEvent.click(screen.getByRole('button', { name: 'Save the file' }));
    await screen.findByText(/^Saved as /);
    expect(fake.saved).toHaveLength(1);
  });

  it('has no accessibility violations in either step', async () => {
    await setup();
    render(<FeedbackDialog onClose={() => {}} />);
    const dialog = await screen.findByRole('dialog', { name: 'Send feedback' });
    await expectNoAxeViolations(dialog);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Review the file' }));
    await screen.findByRole('region', { name: 'The whole file' });
    await expectNoAxeViolations(dialog);
  });
});

describe('Safe start', () => {
  const crashed = (previousWasSafe = false): Options => ({
    startup: {
      report: { previous: 'crashed', crashesInARow: 2, offerSafeMode: true, previousWasSafe },
      safeMode: false,
      stats: { sessions: 10, clean: 8, crashed: 2 },
    },
  });

  it('offers nothing after a clean session', async () => {
    const { app } = await setup();
    await offerSafeStart(app.platform);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(safeModeStore.get()).toBe(false);
  });

  it('offers safe mode after two crashes, with two equal buttons, and starts in it on a yes', async () => {
    const { app, fake } = await setup(crashed());
    const done = offerSafeStart(app.platform);
    const dialog = await screen.findByRole('dialog', { name: 'OpenNote did not close properly' });
    const [normal, safe] = ['Start normally', 'Start in safe mode'].map((name) =>
      within(dialog).getByRole('button', { name }),
    );
    expect(normal!.className).toBe(safe!.className);
    expect(within(dialog).getByText('Background work, such as search indexing')).toBeTruthy();
    await expectNoAxeViolations(dialog);
    fireEvent.click(safe!);
    await done;
    expect(fake.calls).toContain('enterSafeMode');
    expect(safeModeStore.get()).toBe(true);
  });

  it('starts normally on Escape, and records nothing', async () => {
    const { app, fake } = await setup(crashed());
    const done = offerSafeStart(app.platform);
    await screen.findByRole('dialog');
    await waitFor(() => expect(hasModalLayer()).toBe(true));
    fireEvent.keyDown(window, { key: 'Escape' });
    await done;
    expect(fake.calls).not.toContain('enterSafeMode');
    expect(safeModeStore.get()).toBe(false);
  });

  it('points to feedback when safe mode did not help', async () => {
    await setup();
    const flow = openSafeStart(crashed(true).startup!.report)!;
    render(<SafeStartDialog flow={flow} onChoose={() => {}} />);
    expect(await screen.findByRole('dialog', { name: 'OpenNote stopped again in safe mode' })).toBeTruthy();
    expect(screen.getByText(/send feedback so the cause can be found/)).toBeTruthy();
  });

  it('says safe mode is on in words, lists what is off, and restarts normally', async () => {
    const { fake } = await setup();
    expect(screen.queryByRole('button', { name: 'OpenNote is in safe mode' })).toBeNull();
    safeModeStore.set(true);
    fireEvent.click(await screen.findByRole('button', { name: 'OpenNote is in safe mode' }));
    expect(await screen.findByText('Embeds, which show their saved preview instead')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Restart normally' }));
    await waitFor(() => expect(fake.state.restarts).toBe(1));
  });
});

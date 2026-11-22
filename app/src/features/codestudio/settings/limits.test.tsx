// The limit fields in Settings, then Code (review gap G7): what is typed stays as typed and is clamped and saved
// when the field is left or Enter is pressed. Clamping each keystroke turned a typed 128 into 256.
import { screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { getSettings } from '../../../state/settings';
import { renderUi } from '../../../test';
import CodeSettingsSection from './CodeSettingsSection';

describe('the code limit fields', () => {
  it('saves a typed memory limit on leaving the field, and a typed time limit on Enter', async () => {
    renderUi(<CodeSettingsSection />);
    const memory = await screen.findByLabelText('Memory limit (MiB)');
    await userEvent.clear(memory);
    await userEvent.type(memory, '128');
    expect((memory as HTMLInputElement).value).toBe('128');
    await userEvent.tab();
    await waitFor(() => expect(getSettings().code.memoryLimitMib).toBe(128));

    const time = screen.getByLabelText('Time limit (seconds)');
    await userEvent.clear(time);
    await userEvent.type(time, '45');
    expect((time as HTMLInputElement).value).toBe('45');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(getSettings().code.timeLimitSeconds).toBe(45));
  });

  it('clamps an out-of-range value when it is saved', async () => {
    renderUi(<CodeSettingsSection />);
    const memory = await screen.findByLabelText('Memory limit (MiB)');
    await userEvent.clear(memory);
    await userEvent.type(memory, '9999');
    await userEvent.tab();
    await waitFor(() => expect(getSettings().code.memoryLimitMib).toBe(256));
  });
});

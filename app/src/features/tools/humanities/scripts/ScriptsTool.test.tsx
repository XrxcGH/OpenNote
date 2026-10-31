// Scripts in the window: typing with the IPA keyboard, romanizing Russian, Korean in both systems, and Thai tones.
import { fireEvent, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations, renderUi } from '../../../../test';
import { ScriptsTool } from './ScriptsTool';

describe('scripts tool', () => {
  it('types IPA from the keyboard into the compose field', async () => {
    const { container } = renderUi(<ScriptsTool />);
    await expectNoAxeViolations(container);
    fireEvent.click(screen.getByRole('button', { name: 'ʃ, U+0283' }));
    fireEvent.click(screen.getByRole('button', { name: 'ə, U+0259' }));
    expect((screen.getByRole('textbox', { name: /^Compose/ }) as HTMLTextAreaElement).value).toBe('ʃə');
  });

  it('romanizes Russian and Korean', () => {
    renderUi(<ScriptsTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Romanize' }));
    expect(screen.getByText('Chaĭkovskiĭ')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Korean' }));
    expect(screen.getByText('Dongnimmun')).toBeTruthy();
    expect(screen.getByText('Tongnimmun')).toBeTruthy();
  });

  it('works out a Thai tone', () => {
    renderUi(<ScriptsTool />);
    fireEvent.click(screen.getByRole('tab', { name: 'Thai tones' }));
    fireEvent.change(screen.getByRole('textbox', { name: /^Thai syllable/ }), { target: { value: 'ขา' } });
    expect(screen.getByText('rising')).toBeTruthy();
  });
});

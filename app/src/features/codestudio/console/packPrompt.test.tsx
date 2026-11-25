// A run that needs a runtime download offers Download and Cancel in the console (T4-D09-6).
import { act, screen } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { StudioController } from '../window/controller';
import { scratchSource } from '../window/source';
import { ConsolePanel } from './ConsolePanel';

function Harness({ controller }: { controller: StudioController }) {
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <ConsolePanel controller={controller} />;
}

let controller: StudioController | null = null;
afterEach(() => controller?.dispose());

describe('the console after a run that needs a download', () => {
  it('offers Download and Cancel, and Cancel takes the offer away', async () => {
    controller = new StudioController();
    controller.mount();
    controller.open(scratchSource());
    const studio = controller;
    studio.setLanguage('c');
    renderUi(<Harness controller={studio} />);
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
    act(() => {
      studio.missingPack = 'c';
      studio.changed();
    });
    expect(await screen.findByRole('button', { name: 'Download' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  });
});

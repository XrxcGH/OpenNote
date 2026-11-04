// T3-16: the properties panel opens closed on every page, and Escape closes it, unless the person is typing elsewhere.
import { describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { renderUi } from '../../../test/render';
import type { OpenPage } from '../../../services/pages/types';
import { PropertiesBar } from './PropertiesBar';

const stub = {
  initial: { view: {} },
  onFrame: () => () => undefined,
  send: () => Promise.resolve(),
} as unknown as OpenPage;

const fold = () => document.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
const expanded = () => fold().getAttribute('aria-expanded');

describe('the properties panel and Escape', () => {
  it('starts closed on every page, even after it was open on another', async () => {
    const first = renderUi(<PropertiesBar page={stub} />);
    await userEvent.click(fold());
    expect(expanded()).toBe('true');
    first.unmount();
    renderUi(<PropertiesBar page={stub} />);
    expect(expanded()).toBe('false');
  });

  it('closes on Escape with focus outside the panel', async () => {
    renderUi(<PropertiesBar page={stub} />);
    await userEvent.click(fold());
    (document.activeElement as HTMLElement | null)?.blur();
    await userEvent.keyboard('{Escape}');
    expect(expanded()).toBe('false');
  });

  it('closes on Escape with focus on its fold button', async () => {
    renderUi(<PropertiesBar page={stub} />);
    await userEvent.click(fold());
    fold().focus();
    await userEvent.keyboard('{Escape}');
    expect(expanded()).toBe('false');
  });

  it('stays open when Escape is pressed while typing in the page editor', async () => {
    renderUi(<PropertiesBar page={stub} />);
    await userEvent.click(fold());
    const editor = document.body.appendChild(document.createElement('div'));
    editor.contentEditable = 'true';
    editor.focus();
    await userEvent.keyboard('{Escape}');
    expect(expanded()).toBe('true');
    editor.remove();
  });
});

describe('property edits', () => {
  it('go through the page sync queue, so Undo can take them back (Beta 8 walk B2-B13-2)', async () => {
    const sent: unknown[] = [];
    const page = {
      initial: { view: { properties: { fields: [{ id: 'a', name: 'Topic', type: 'text', value: 'Cells' }] } } },
      onFrame: () => () => undefined,
      send: () => Promise.reject(new Error('Property edits must go through the queue.')),
    } as unknown as OpenPage;
    const sync = { send: (batch: unknown) => (sent.push(batch), Promise.resolve()) } as unknown as Pick<
      OpenPage,
      'send'
    >;
    renderUi(<PropertiesBar page={page} sync={sync} />);
    await userEvent.click(fold());
    await userEvent.click(document.querySelector<HTMLButtonElement>('button[aria-label^="Remove"]')!);
    expect(sent).toEqual([{ edits: [{ edit: 'setPage', view: { properties: null } }] }]);
  });
});

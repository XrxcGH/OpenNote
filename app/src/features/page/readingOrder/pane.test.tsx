// Names by reading order and the Reading order pane in a real browser.
import { render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { initFlags } from '../../../app/flags';
import { createMemoryPageService } from '../../../services/pages/memory';
import type { BlockJson } from '../../../services/pages/types';
import { announcements } from '../../../test';
import { mountPage } from '../mount';
import type { MountedPage } from '../mount';
import { textPageFixture } from '../test/fixtures';
import { ReadingOrderPane } from './ReadingOrderPane';

const shown: { mounted: MountedPage; container: HTMLElement }[] = [];

afterEach(async () => {
  for (const { mounted, container } of shown.splice(0)) {
    await mounted.destroy();
    container.remove();
  }
});

const [RIGHT, LEFT, FLOW] = ['01k6f0000000000000000t000r', '01k6f0000000000000000t000l', '01k6f0000000000000000t000f'];

async function open() {
  initFlags('dev', { 'page.editor': true, 'page.readingOrder': true });
  const base = textPageFixture('').page;
  const block = (id: string, order: string, markdown: string, x?: number): BlockJson => ({
    id,
    type: 'text',
    order,
    created: base.created,
    modified: base.created,
    ...(x === undefined ? {} : { frame: { x, y: 300 } }),
    data: { markdown },
  });
  const fixture = {
    page: {
      ...base,
      blocks: [
        block(RIGHT, 'a0', '## Right note', 400),
        block(LEFT, 'a1', 'Left **note**', 40),
        block(FLOW, 'a2', 'Flowing'),
      ],
    },
  };
  const service = createMemoryPageService([fixture]);
  const page = await service.open(fixture.page.id, { viewport: null });
  const container = document.body.appendChild(document.createElement('div'));
  Object.assign(container.style, { position: 'fixed', left: '0', top: '0', width: '800px', height: '500px' });
  const mounted = mountPage(container, page, { classNames: { viewport: '', world: '', underlay: '' }, shown: false });
  shown.push({ mounted, container });
  return { mounted, edits: () => service.sent(page.id).flatMap((batch) => batch.edits) };
}

describe('names by reading order', () => {
  it('names flowing text and numbers floating text boxes in reading order', async () => {
    const { mounted } = await open();
    const name = (id: string) => mounted.layer.view(id)!.editRoot!.getAttribute('aria-label');
    expect(name(FLOW)).toBe('Page text');
    expect(name(LEFT)).toBe('Text box 1 of 2');
    expect(name(RIGHT)).toBe('Text box 2 of 2');
    expect(mounted.layer.view(LEFT)!.element.getAttribute('aria-label')).toBe('Left note');
    expect(mounted.layer.view(LEFT)!.element.getAttribute('aria-roledescription')).toBe('text box');
  });
});

describe('the Reading order pane', () => {
  it('lists the blocks in reading order and moves one with Alt+Shift+Arrow', async () => {
    const { mounted, edits } = await open();
    render(<ReadingOrderPane mounted={mounted} onClose={() => undefined} />);
    const list = screen.getByRole('listbox', { name: 'Blocks in reading order' });
    const labels = () =>
      within(list)
        .getAllByRole('option')
        .map((option) => option.textContent);
    expect(labels()).toEqual(['Text: Flowing', 'Text: Left note', 'Text: Right note']);
    list.focus();
    await userEvent.keyboard('{ArrowDown}{Alt>}{Shift>}{ArrowDown}{/Shift}{/Alt}');
    await expect.poll(labels).toEqual(['Text: Flowing', 'Text: Right note', 'Text: Left note']);
    await expect.poll(edits).toContainEqual({ edit: 'setPage', view: { readingOrder: [FLOW, RIGHT, LEFT] } });
    expect(announcements()).toContain('Moved to 3 of 3.');
    const order = [...mounted.flow.element.children].map((element) => (element as HTMLElement).dataset.blockId);
    expect(order).toEqual([FLOW, RIGHT, LEFT]);
    expect(mounted.layer.view(RIGHT)!.editRoot!.getAttribute('aria-label')).toBe('Text box 1 of 2');
    // The page covers the pane in this test, so the button is pressed directly.
    screen.getByRole('button', { name: 'Reset to default order' }).click();
    await expect.poll(labels).toEqual(['Text: Flowing', 'Text: Left note', 'Text: Right note']);
    expect(edits()).toContainEqual({ edit: 'setPage', view: { readingOrder: null } });
  });
});

describe('the Reading order pane after typing', () => {
  it('names a text box by what was typed into it, not by what it opened with', async () => {
    const { mounted } = await open();
    const editor = mounted.pool.mount(FLOW, { kind: 'end' }, 'target');
    expect(editor).toBeTruthy();
    editor!.commands.focus('end');
    editor!.commands.insertContent(' and typed');
    render(<ReadingOrderPane mounted={mounted} onClose={() => undefined} />);
    const list = screen.getByRole('listbox', { name: 'Blocks in reading order' });
    const labels = within(list)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(labels).toContain('Text: Flowing and typed');
  });
});

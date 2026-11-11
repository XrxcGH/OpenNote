// The Format pane (text DESIGN.md 5.3), in a real browser. Typed values with units reach the document. A bad value
// shows its range message and changes nothing. Reveal formatting lists the sources, and style mode edits a style.
// Every tab works from the keyboard with no axe violations in either theme.
import { act, screen, within } from '@testing-library/react';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setRunValue, toggleRunMark } from '../../../editor/commands/runFormat';
import { mountEditor } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { paraFormat } from '../../../editor/paragraph/attributes';
import { expectNoAxeViolations } from '../../../test';
import { notebookStyles, pageSheet, configureStyleStorage, localStylesClient } from '../styles/store';
import { TABS } from './fields';
import { closeFormatPane, openFormatPane } from './mount';

let mounted: TestEditor | null = null;

beforeEach(() => {
  configureStyleStorage({ client: localStylesClient(null), persistent: false, storage: null });
  notebookStyles.set({ nb: { h2: { font: 'Georgia' } } });
});

afterEach(() => {
  act(() => closeFormatPane());
  mounted?.destroy();
  mounted = null;
  notebookStyles.set({});
  pageSheet.set(null);
  configureStyleStorage(null);
  document.documentElement.removeAttribute('data-theme');
  document.body.replaceChildren();
});

function open(source: string, options: Partial<Parameters<typeof openFormatPane>[0]> = {}) {
  mounted = mountEditor(source);
  const editor = mounted.editor;
  act(() => openFormatPane({ notebook: 'nb', editorOf: () => editor, ...options }));
  return editor;
}

const pane = () => document.querySelector<HTMLElement>('[data-region="format-pane"]')!;

async function typeIn(name: string | RegExp, text: string) {
  const box = within(pane()).getByRole('spinbutton', { name });
  await userEvent.clear(box);
  await userEvent.type(box, `${text}{Enter}`);
}

describe('the Format pane', () => {
  it('applies 10.5 typed in Size as data-size 10.5', async () => {
    open('one [two] three');
    await typeIn('Size', '10.5');
    expect(mounted!.markdown()).toBe('one <span data-size="10.5">two</span> three');
  });

  it('applies 0.5in typed in Left indent as start 36 on the Paragraph tab', async () => {
    const editor = open('one [two] three', { tab: 'paragraph' });
    await typeIn('Left indent', '0.5in');
    expect(paraFormat(editor.state.doc.firstChild!.attrs).indent?.start).toBe(36);
  });

  it('shows the range message for an invalid value and changes nothing', async () => {
    open('one [two] three');
    const before = mounted!.markdown();
    await typeIn('Size', '0');
    const alert = await within(pane()).findByRole('alert');
    expect(alert.textContent).toBe('The number must be between 1 and 1638.');
    expect(within(pane()).getByRole('spinbutton', { name: 'Size' }).getAttribute('aria-invalid')).toBe('true');
    expect(mounted!.markdown()).toBe(before);
  });

  it('shows a range message on the Paragraph tab too', async () => {
    const editor = open('one [two] three', { tab: 'paragraph' });
    await typeIn('Left indent', '5000');
    expect((await within(pane()).findByRole('alert')).textContent).toBe('The number must be between -1584 and 1584.');
    expect(paraFormat(editor.state.doc.firstChild!.attrs).indent).toBeUndefined();
  });
});

describe('the Format pane, reveal and style mode', () => {
  it('reveals Bold (direct) and Georgia (style Heading 2) for a heading with bold set directly', async () => {
    const editor = open('## [Title]');
    act(() => {
      toggleRunMark('bold')(editor.state, editor.view.dispatch);
    });
    await userEvent.click(within(pane()).getByRole('button', { name: 'Reveal formatting' }));
    const list = await within(pane()).findByRole('list', { name: 'Formatting at the caret' });
    const rows = within(list)
      .getAllByRole('listitem')
      .map((row) => row.textContent);
    expect(rows).toContain('Bold (direct)');
    expect(rows).toContain('Georgia (style Heading 2)');
  });

  it('follows the selection: the Font box shows what the text has', async () => {
    const editor = open('one [two] three');
    act(() => {
      setRunValue('font', 'Palatino')(editor.state, editor.view.dispatch);
    });
    expect(within(pane()).getByRole('textbox', { name: 'Font' })).toBeTruthy();
    expect((within(pane()).getByRole('textbox', { name: 'Font' }) as HTMLInputElement).value).toBe('Palatino');
  });

  it('edits a style in style mode and saves it to the notebook', async () => {
    open('## [Title]', { style: 'h2', tab: 'text' });
    expect(within(pane()).getByRole('heading', { name: 'Format style: Heading 2' })).toBeTruthy();
    expect(within(pane()).queryByRole('tab', { name: 'Tabs' })).toBeNull();
    await typeIn('Size', '20');
    await act(async () => Promise.resolve());
    expect(notebookStyles.get()['nb']?.['h2']).toMatchObject({ font: 'Georgia', sizePt: 20 });
  });
});

describe('the Format pane, keyboard and accessibility', () => {
  it('walks every tab from the keyboard and each panel has labeled controls', async () => {
    open('one [two] three');
    const tabs = within(pane()).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Text',
      'Advanced',
      'Paragraph',
      'Tabs',
      'Borders and shading',
      'Lists',
    ]);
    tabs[0].focus();
    for (let index = 0; index < TABS.length; index += 1) {
      const current = within(pane()).getAllByRole('tab')[index];
      expect(document.activeElement).toBe(current);
      expect(current.getAttribute('aria-selected')).toBe('true');
      const panel = within(pane()).getByRole('tabpanel');
      expect(panel.getAttribute('aria-labelledby')).toBe(current.id);
      await userEvent.tab();
      expect(panel.contains(document.activeElement) || index === TABS.length - 1).toBe(true);
      for (const control of panel.querySelectorAll('input, select, button')) {
        const labelled =
          (control as HTMLElement).getAttribute('aria-label') ||
          (control as HTMLInputElement).labels?.length ||
          control.textContent?.trim();
        expect(labelled, control.outerHTML).toBeTruthy();
      }
      (within(pane()).getAllByRole('tab')[index] as HTMLElement).focus();
      await userEvent.keyboard('{ArrowRight}');
    }
    // Arrows wrap from the last tab to the first.
    expect(document.activeElement).toBe(within(pane()).getAllByRole('tab')[0]);
  });

  it('closes with Escape and gives the focus back', async () => {
    const opener = document.body.appendChild(document.createElement('button'));
    opener.focus();
    open('one [two] three');
    within(pane()).getAllByRole('tab')[0].focus();
    await userEvent.keyboard('{Escape}');
    expect(document.querySelector('[data-region="format-pane"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it.each(['light', 'dark'])('has no axe violations on any tab in the %s theme', async (theme) => {
    document.documentElement.dataset['theme'] = theme;
    open('one [two] three');
    for (const name of ['Text', 'Advanced', 'Paragraph', 'Tabs', 'Borders and shading', 'Lists']) {
      await userEvent.click(within(pane()).getByRole('tab', { name }));
      await expectNoAxeViolations(pane());
    }
  });

  it('shows the Lists tab for a list item', async () => {
    open('- [one]', { tab: 'lists' });
    expect(within(pane()).getByRole('combobox', { name: 'Number format' })).toBeTruthy();
    expect(screen.queryByText('Put the caret in a list item to change its list.')).toBeNull();
  });
});

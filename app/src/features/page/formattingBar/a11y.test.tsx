// WP4's interface in a real browser, checked with axe in both themes. It covers the formatting bar, the link
// popover, the slash menu, the fold button, the text styles editor, and the settings parts.
import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '../registrations/editor';
import { mountEditor, typeInto } from '../../../editor/commands/testing';
import type { TestEditor } from '../../../editor/commands/testing';
import { expectNoAxeViolations, renderUi } from '../../../test';
import EditingAutoCorrect from '../settings/EditingAutoCorrect';
import EditingGeneral from '../settings/EditingGeneral';
import { StyleEditor } from '../styles/TextStylesDialog';
import { openLinkPopover } from '../linkPopover/LinkPopover';
import { closeFormattingBar, showFormattingBar } from './bar';

const THEMES = ['light', 'dark'] as const;
// A custom color a person might pick, which shows the contrast warning.
// checks-disable-next-line brand-consistency: a person's own color, to show the warning
const HARD_TO_READ = '#f2d40c';
let mounted: TestEditor | null = null;

afterEach(() => {
  closeFormattingBar();
  mounted?.destroy();
  mounted = null;
  document.querySelectorAll('[role="listbox"]').forEach((element) => element.remove());
});

/** An editor named as the page's text blocks name theirs. */
function mount(source: string): TestEditor {
  mounted = mountEditor(source);
  const editable = mounted.editor.view.dom;
  editable.setAttribute('role', 'textbox');
  editable.setAttribute('aria-multiline', 'true');
  editable.setAttribute('aria-label', 'Text');
  return mounted;
}

describe('WP4’s interface', () => {
  for (const theme of THEMES) {
    it(`the formatting bar passes axe in the ${theme} theme`, async () => {
      document.documentElement.dataset.theme = theme;
      showFormattingBar(new DOMRect(200, 200, 80, 20));
      const bar = await screen.findByRole('toolbar', { name: 'Formatting' });
      expect(bar.querySelectorAll('button').length).toBeGreaterThanOrEqual(2);
      await expectNoAxeViolations(bar);
    });

    it(`the fold button passes axe in the ${theme} theme`, async () => {
      document.documentElement.dataset.theme = theme;
      const page = mount('## Light reactions\n\nText');
      expect(page.root.querySelector('button[aria-expanded="true"]')).not.toBeNull();
      await expectNoAxeViolations(page.root);
    });

    it(`the slash menu passes axe in the ${theme} theme`, async () => {
      document.documentElement.dataset.theme = theme;
      const page = mount('[]');
      page.editor.commands.focus();
      typeInto(page.editor, '/');
      await vi.waitFor(() => expect(document.querySelector('[role="listbox"]')).not.toBeNull(), { timeout: 10_000 });
      expect(document.querySelectorAll('[role="listbox"]')).toHaveLength(1);
      await expectNoAxeViolations(document.querySelector('[role="listbox"]')!);
      await expectNoAxeViolations(page.root);
    });

    it(`the link popover passes axe in the ${theme} theme`, async () => {
      document.documentElement.dataset.theme = theme;
      const page = mount('a [b] c');
      const closed = openLinkPopover(page.editor);
      const dialog = await screen.findByRole('dialog', { name: 'Link' });
      await expectNoAxeViolations(dialog);
      const field = dialog.querySelector('input')!;
      field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await closed;
    });

    it(`the text styles editor passes axe in the ${theme} theme`, async () => {
      const { container } = renderUi(<StyleEditor initial={{ h2: { color: HARD_TO_READ } }} onChange={() => {}} />, {
        theme,
      });
      await expectNoAxeViolations(container);
    });

    it(`the editing settings pass axe in the ${theme} theme`, async () => {
      const { container } = renderUi(
        <>
          <EditingGeneral />
          <EditingAutoCorrect />
        </>,
        { theme },
      );
      expect(screen.getByRole('switch', { name: 'Markdown shortcuts' })).toBeTruthy();
      await expectNoAxeViolations(container);
    });
  }
});

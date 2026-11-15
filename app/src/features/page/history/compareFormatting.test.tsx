// @vitest-environment jsdom
// The compare view's formatting line (ADR 0086, text DESIGN.md 9): two versions that differ only by bold show
// "Formatting changed: bold added to …". The expected text is worked by hand from the two versions.
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, expect, it } from 'vitest';
import { diffPages } from '../../../editor/diff/pageDiff';
import type { DiffBlock } from '../../../editor/diff/pageDiff';
import { CompareView } from './CompareView';

const text = (markdown: string): DiffBlock => ({ id: 'b', type: 'text', order: 'a0', data: { markdown } });

afterEach(cleanup);

it("shows 'Formatting changed: bold added' for two versions that differ only by bold", () => {
  const diff = diffPages({ blocks: [text('Plants grow.')] }, { blocks: [text('Plants **grow**.')] });
  render(createElement(CompareView, { diff, actions: { restoreParagraph: () => {}, restoreBlock: () => {} } }));
  expect(screen.getByText(/^Formatting changed:/).textContent).toBe('Formatting changed: bold added to “grow”');
});

import { render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { expectNoAxeViolations } from '../../test';
import { Button } from '../../ui';
import { Gallery, galleryHref } from './Gallery';
import type { GalleryEntry } from './registry';
import { entries as realEntries } from './entries';

function Counter() {
  const [count, setCount] = useState(0);
  return <Button onClick={() => setCount(count + 1)}>Pressed {count} times</Button>;
}

const entries: GalleryEntry[] = [
  { id: 'ui.button', title: 'Buttons', group: 'Primitives', description: 'The variants.', render: () => <Counter /> },
  { id: 'ui.other', title: 'Other', group: 'Primitives', render: () => <p>Other content</p> },
];

describe('the list', () => {
  it('lists each entry under its group as a link to its own page', async () => {
    const { container } = render(<Gallery entries={entries} entryId={null} theme="light" density="mouse" />);
    expect(screen.getByRole('heading', { level: 2, name: 'Primitives' })).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Buttons' });
    expect(link.getAttribute('href')).toBe('?entry=ui.button');
    await expectNoAxeViolations(container);
  });

  it('says how to add an entry when there are none', () => {
    render(<Gallery entries={[]} entryId={null} theme="light" density="mouse" />);
    expect(screen.getByText(/No entries yet/)).toBeTruthy();
  });
});

describe('one entry', () => {
  it('shows the entry alone, in a region a screenshot can target', async () => {
    const { container } = render(<Gallery entries={entries} entryId="ui.button" theme="light" density="mouse" />);
    const region = screen.getByRole('region', { name: 'Buttons' });
    expect(region.getAttribute('data-gallery-entry')).toBe('ui.button');
    expect(within(region).getByRole('button', { name: 'Pressed 0 times' })).toBeTruthy();
    expect(screen.queryByText('Other content')).toBeNull();
    await expectNoAxeViolations(container);
  });

  it('lets an entry use state', () => {
    render(<Gallery entries={entries} entryId="ui.button" theme="light" density="mouse" />);
    screen.getByRole('button', { name: 'Pressed 0 times' }).click();
    return expect.poll(() => screen.queryByRole('button', { name: 'Pressed 1 times' })).toBeTruthy();
  });

  it('says so when the entry does not exist', () => {
    render(<Gallery entries={entries} entryId="no.such" theme="light" density="mouse" />);
    expect(screen.getByText(/There is no entry named no\.such/)).toBeTruthy();
  });
});

describe('the appearance links', () => {
  it('keep the entry and switch one choice', () => {
    render(<Gallery entries={entries} entryId="ui.button" theme="light" density="mouse" />);
    expect(screen.getByRole('link', { name: 'Dark theme' }).getAttribute('href')).toBe('?entry=ui.button&theme=dark');
    expect(screen.getByRole('link', { name: 'Touch density' }).getAttribute('href')).toBe(
      '?entry=ui.button&density=touch',
    );
  });

  it('build addresses with only what differs from the defaults', () => {
    expect(galleryHref(null, 'light', 'mouse')).toBe('?');
    expect(galleryHref('a.b', 'dark', 'touch')).toBe('?entry=a.b&theme=dark&density=touch');
  });
});

describe('the entries the packages list', () => {
  it('have no repeated id, and each renders', () => {
    for (const entry of realEntries) {
      const { unmount } = render(<Gallery entries={realEntries} entryId={entry.id} theme="light" density="mouse" />);
      expect(screen.getByRole('region', { name: entry.title })).toBeTruthy();
      unmount();
    }
    expect(realEntries.length).toBeGreaterThan(0);
  });
});

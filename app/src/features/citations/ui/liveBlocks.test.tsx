// Citation and bibliography blocks follow the chosen style: change the style (or a source) and what the page shows
// changes with it.
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderUi } from '../../../test';
import { blankSource } from '../model';
import type { Source } from '../model';
import { saveSource, setStyle, setSources } from '../store';
import { LiveBibliography, LiveCitation, inlineNodes } from './liveBlocks';
import { CitationNetworkUse } from './NetworkUse';

const NOTEBOOK = 'nb-live';
const smith: Source = {
  ...blankSource('article'),
  id: 'smith',
  title: 'Sleep and Memory in Students',
  authors: [
    { family: 'Smith', given: 'Jane Q.' },
    { family: 'Lee', given: 'Wei' },
  ],
  year: '2020',
  container: 'Journal of Learning',
  volume: '12',
  issue: '3',
  pages: '45–67',
};
const garcia: Source = {
  ...blankSource('book'),
  id: 'garcia',
  title: 'Notes on Notes',
  authors: [{ family: 'Garcia', given: 'Maria' }],
  year: '2018',
  publisher: 'Open Press',
};

beforeEach(() => {
  localStorage.clear();
  setSources(NOTEBOOK, [smith, garcia]);
  setStyle('apa');
});
afterEach(() => {
  setStyle('apa');
  setSources(NOTEBOOK, []);
});

describe('a citation block', () => {
  it('is written in the chosen style, and follows a change of style', async () => {
    renderUi(<LiveCitation notebook={NOTEBOOK} source="smith" />);
    expect(screen.getByText('(Smith & Lee, 2020)')).toBeTruthy();
    setStyle('ieee');
    await waitFor(() => expect(screen.getByText('[1]')).toBeTruthy());
    setStyle('vancouver');
    await waitFor(() => expect(screen.getByText('[1]')).toBeTruthy());
    setStyle('ama');
    await waitFor(() => expect(screen.getByText('¹')).toBeTruthy());
  });

  it('follows a change to the source', async () => {
    renderUi(<LiveCitation notebook={NOTEBOOK} source="smith" />);
    saveSource(NOTEBOOK, { ...smith, authors: [{ family: 'Jones', given: 'Pat' }] });
    await waitFor(() => expect(screen.getByText('(Jones, 2020)')).toBeTruthy());
  });

  it('says so when the source is gone', () => {
    renderUi(<LiveCitation notebook={NOTEBOOK} source="nope" />);
    expect(screen.getByText('This source is not in the list any more.')).toBeTruthy();
  });
});

describe('a bibliography block', () => {
  it('lists the sources in the chosen style and order, and follows a change of style', async () => {
    renderUi(<LiveBibliography notebook={NOTEBOOK} sources={null} />);
    let items = screen.getAllByRole('listitem');
    expect(items[0].textContent).toMatch(/^Garcia, M\. \(2018\)\. Notes on Notes\./);
    setStyle('vancouver');
    await waitFor(() => expect(screen.getAllByRole('listitem')[0].textContent).toMatch(/^1\. Smith JQ, Lee W\./));
    items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
  });

  it('can list only the sources it names', () => {
    renderUi(<LiveBibliography notebook={NOTEBOOK} sources={['garcia']} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('says so when there is nothing to list', () => {
    renderUi(<LiveBibliography notebook="empty-notebook" sources={null} />);
    expect(screen.getByText('There are no sources to list.')).toBeTruthy();
  });
});

describe('entry text', () => {
  it('turns italics and bold into elements and never into markup', () => {
    const nodes = inlineNodes('A *Title* in **2020** <b>x</b>');
    expect(nodes).toHaveLength(5);
  });
});

describe('the Privacy panel row', () => {
  it('names the two sites and says nothing has been looked up yet', () => {
    renderUi(
      <ul>
        <CitationNetworkUse />
      </ul>,
    );
    expect(screen.getByText(/api\.crossref\.org, openlibrary\.org/)).toBeTruthy();
    expect(screen.getByText('Never looked up.')).toBeTruthy();
  });
});

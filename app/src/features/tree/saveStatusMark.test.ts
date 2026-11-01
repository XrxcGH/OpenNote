// The save status on the document root, where the e2e specs read it even when the title bar has no room for it.
import { beforeEach, describe, expect, it } from 'vitest';
import { pageUnwritten, sendingPage } from '../../services/pages/saveHealth';
import { resetStores } from '../../state/store';
import { markSaveStatus } from './SaveStatus';

beforeEach(() => resetStores());

describe('the save status on the root', () => {
  it('follows the status, and says what holds it at Saving', () => {
    const root = { dataset: {} } as HTMLElement;
    const stop = markSaveStatus(root);
    expect(root.dataset).toEqual({ saveState: 'saved', saveWaiting: 'none' });
    const arrived = sendingPage();
    pageUnwritten('p1', 4);
    expect(root.dataset).toEqual({ saveState: 'saving', saveWaiting: 'sending 1; unwritten p1@4' });
    arrived();
    expect(root.dataset.saveWaiting).toBe('unwritten p1@4');
    stop();
    pageUnwritten('p2', 1);
    expect(root.dataset.saveWaiting).toBe('unwritten p1@4');
  });
});

// @vitest-environment jsdom
// The desktop shell opens a popped tool as index.html with no query and names the tool in __OPENNOTE_TOOL__ (review
// gap G2). The popped studio must then open the main window's block through the relay, not the scratch project.
import { afterEach, describe, expect, it } from 'vitest';
import { chooseSource } from './choose';
import type { Channel } from './relay';
import { CURRENT_KEY, RELAY_CHANNEL, serveRelay } from './relay';
import type { ProjectSource } from './source';

const scope = window as { __OPENNOTE_TOOL__?: string };

afterEach(() => {
  delete scope.__OPENNOTE_TOOL__;
  localStorage.clear();
});

describe('the project a popped studio opens', () => {
  it('opens the main window block through the relay in the window the desktop shell opens', async () => {
    const data = { name: 'From the page' };
    const block: ProjectSource = {
      key: 'b1',
      kind: 'block',
      data: () => data,
      readOnly: () => false,
      patch: () => {},
      subscribe: () => () => {},
      live: () => true,
      onLeave: () => () => {},
      dispose: () => {},
    };
    const main = new BroadcastChannel(RELAY_CHANNEL);
    const stop = serveRelay(main as unknown as Channel, (id) => (id === 'b1' ? block : null));
    scope.__OPENNOTE_TOOL__ = 'code';
    localStorage.setItem(CURRENT_KEY, 'b1');
    const source = await chooseSource(null);
    expect(source.kind).toBe('remote');
    expect(source.data()).toEqual(data);
    source.dispose();
    stop();
    main.close();
  });
});

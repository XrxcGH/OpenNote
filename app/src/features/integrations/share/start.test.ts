import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../ui', () => ({ showToast: vi.fn() }));

import { showToast } from '../../../ui';
import type { ShareBlocks, ShareDeps } from './receive';
import { receiveShares } from './start';

const share = (text: string): ShareBlocks => ({ title: 'T', text, link: null, markdown: text, files: [], skipped: [] });
const transfer = () => ({ setData: vi.fn(), items: { add: vi.fn() } }) as unknown as DataTransfer;

describe('receiveShares', () => {
  it('adds each waiting share and says where it went', async () => {
    const target = new EventTarget();
    const deps: ShareDeps = { pasteTarget: () => target, quickNote: vi.fn(), openForPaste: vi.fn(), transfer };
    expect(await receiveShares(async () => [share('a'), share('b')], deps)).toBe(2);
    const messages = vi.mocked(showToast).mock.calls.map(([spec]) => spec.message);
    expect(messages.filter((message) => message.includes('on this page'))).toHaveLength(2);
  });

  it('makes a quick note with an Open action when no page can take it', async () => {
    vi.mocked(showToast).mockClear();
    const open = vi.fn();
    const deps: ShareDeps = {
      pasteTarget: () => null,
      quickNote: vi.fn(async () => 'page1'),
      openForPaste: vi.fn(),
      transfer,
    };
    await receiveShares(async () => [share('hello')], deps, open);
    const spec = vi.mocked(showToast).mock.calls[0][0];
    expect(spec.message).toContain('Quick notes');
    spec.action!.run();
    expect(open).toHaveBeenCalledWith('page1');
  });

  it('does nothing when the inbox can’t be read', async () => {
    const deps: ShareDeps = { pasteTarget: () => null, quickNote: vi.fn(), openForPaste: vi.fn() };
    expect(await receiveShares(() => Promise.reject(new Error('off')), deps)).toBe(0);
    expect(deps.quickNote).not.toHaveBeenCalled();
  });
});

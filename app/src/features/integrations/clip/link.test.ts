import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../ui', () => ({ showToast: vi.fn() }));

import { showToast } from '../../../ui';
import { offerClip, parseClipLink } from './link';

describe('parseClipLink', () => {
  it('reads the address and the title the clipper encodes', () => {
    const link = 'opennote://clip?url=https%3A%2F%2Fexample.org%2Fa%3Fb%3D1&title=A%20page%20%28draft%29';
    expect(parseClipLink(link)).toEqual({ url: 'https://example.org/a?b=1', title: 'A page (draft)' });
    expect(parseClipLink('OpenNote://clip/?url=http%3A%2F%2Fexample.org%2F')).toEqual({
      url: 'http://example.org/',
      title: '',
    });
  });

  it('refuses other links, other schemes, and long links', () => {
    expect(parseClipLink('opennote://page/abcdef')).toBeNull();
    expect(parseClipLink('opennote://clip?url=javascript%3Aalert(1)')).toBeNull();
    expect(parseClipLink('opennote://clip?url=file%3A%2F%2F%2Fc%3A%2Fx')).toBeNull();
    expect(parseClipLink('opennote://clip?url=https%3A%2F%2Fu%3Ap%40example.org%2F')).toBeNull();
    expect(parseClipLink('opennote://clip?title=x')).toBeNull();
    expect(parseClipLink(`opennote://clip?url=https%3A%2F%2Fexample.org%2F&title=${'a'.repeat(600)}`)).toBeNull();
  });

  it('drops control characters and keeps titles short', () => {
    const link = parseClipLink(`opennote://clip?url=https%3A%2F%2Fexample.org%2F&title=a%0Ab${'c'.repeat(300)}`);
    expect(link?.title.startsWith('a b')).toBe(true);
    expect(link?.title.length).toBe(200);
  });
});

describe('offerClip', () => {
  it('asks first and adds the page only when the person chooses Add', async () => {
    const quickNote = vi.fn(async () => 'page1');
    const open = vi.fn();
    expect(offerClip('opennote://clip?url=https%3A%2F%2Fexample.org%2F&title=Hello', { quickNote, open })).toBe(true);
    expect(quickNote).not.toHaveBeenCalled();
    const offer = vi.mocked(showToast).mock.calls.at(-1)![0];
    expect(offer.message).toContain('Hello');
    offer.action!.run();
    await vi.waitFor(() => expect(quickNote).toHaveBeenCalledWith('Hello', 'https://example.org/'));
  });

  it('leaves other links alone', () => {
    expect(offerClip('opennote://page/abcdef', { quickNote: vi.fn(), open: vi.fn() })).toBe(false);
  });
});

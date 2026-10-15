// The shell's node reader: a read that fails once is asked for again, so a title does not stay blank.
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NotesProvider } from '../../services/notes';
import type { NodeId, NodeSummary, NotesService } from '../../services/notes';
import { useNode } from './useNode';

function Title({ id }: { id: NodeId }) {
  return <p data-testid="title">{useNode(id)?.title ?? 'none'}</p>;
}

describe('reading a node', () => {
  it('asks again after a failed read and then shows the title', async () => {
    const page = { id: 'page-1', title: 'Cell structure' } as unknown as NodeSummary;
    const get = vi.fn().mockRejectedValueOnce(new Error('busy')).mockResolvedValue(page);
    const service = { get, watch: () => () => undefined } as unknown as NotesService;
    render(
      <NotesProvider service={service}>
        <Title id={'page-1' as NodeId} />
      </NotesProvider>,
    );
    await expect.poll(() => screen.getByTestId('title').textContent, { timeout: 4000 }).toBe('Cell structure');
    expect(get).toHaveBeenCalledTimes(2);
  });
});

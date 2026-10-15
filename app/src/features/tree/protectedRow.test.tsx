// A password-protected section's row (ADR 0042): a closed or open lock, and the state in its description.
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { NodeId, NodeSummary } from '../../services/notes';
import { describeNode, TreeRow } from './TreeRow';

const section: NodeSummary = {
  id: '01m3sa12426sg32pmtyffjaqs1' as NodeId,
  kind: 'section',
  parentId: null,
  title: 'Diary',
  color: null,
  pageLevel: 0,
  childCount: 0,
  created: '2026-10-01T00:00:00.000Z',
  modified: '2026-10-01T00:00:00.000Z',
  readOnly: false,
};

const noop = () => undefined;

function row(node: NodeSummary) {
  return render(
    <TreeRow
      tree="notebooks"
      row={{ node, level: 1, posinset: 1, setsize: 1 } as never}
      selected={false}
      focused={false}
      renaming={null}
      onPress={noop}
      onToggle={noop}
      onRename={noop}
      onMore={noop}
    />,
  );
}

describe('a protected section row', () => {
  it('shows its lock and says whether it is locked', () => {
    expect(describeNode({ ...section, protected: 'locked' })).toBe('Section, protected, locked');
    expect(describeNode({ ...section, protected: 'unlocked' })).toBe('Section, protected, unlocked');
    expect(describeNode(section)).toBe('Section');
    const locked = row({ ...section, protected: 'locked' });
    expect(locked.container.querySelector('[data-protected="locked"]')).toBeTruthy();
    locked.unmount();
    const plain = row(section);
    expect(plain.container.querySelector('[data-protected]')).toBeNull();
  });
});

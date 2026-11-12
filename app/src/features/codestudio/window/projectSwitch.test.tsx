// Opening another project while the studio is open (review gap G1). Both projects have a file with the same ID
// (f01, main.py). The editor must show the second project's text, and typing must patch only the second project.
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { applyMergePatch } from '../../../platform/mergePatch';
import { starterProject } from '../project/model';
import { StudioController } from './controller';
import { EditorPane } from './EditorPane';
import type { ProjectSource } from './source';

/** A project kept in memory, recording each patch it gets. */
function memorySource(key: string, mainText: string) {
  let data = starterProject(key, mainText) as unknown as Record<string, unknown>;
  const patches: Record<string, unknown>[] = [];
  const source: ProjectSource = {
    key,
    kind: 'block',
    data: () => data,
    readOnly: () => false,
    patch(patch) {
      patches.push(patch);
      data = applyMergePatch(data, patch);
    },
    subscribe: () => () => {},
    live: () => true,
    onLeave: () => () => {},
    dispose: () => {},
  };
  const mainOf = () => (data.files as Record<string, { text: string }>).f01!.text;
  return { source, patches, mainOf };
}

function Pane({ controller }: { controller: StudioController }) {
  useSyncExternalStore(controller.subscribe, controller.snapshot);
  return <EditorPane controller={controller} />;
}

const shownText = (root: HTMLElement) => root.querySelector('.cm-content')?.textContent ?? '';

afterEach(cleanup);

describe('opening another project in the open studio', () => {
  it('shows the new project in the editor and patches only the new project', async () => {
    const alpha = memorySource('alpha', 'alpha_code = 1');
    const beta = memorySource('beta', 'beta_code = 2');
    const controller = new StudioController();
    controller.open(alpha.source);
    const { container } = render(<Pane controller={controller} />);
    await waitFor(() => expect(shownText(container)).toBe('alpha_code = 1'), { timeout: 15_000 });
    controller.setCursor({ line: 1, column: 5 });

    act(() => controller.open(beta.source));
    await waitFor(() => expect(shownText(container)).toBe('beta_code = 2'), { timeout: 15_000 });
    expect(controller.cursor).toEqual({ line: 1, column: 1 });
    expect(container.querySelectorAll('.cm-editor')).toHaveLength(1);

    // Typing goes to the editor the studio now holds, as a keystroke would.
    const editor = await waitFor(() => {
      const found = controller.editorOf('f01');
      expect(found?.getText()).toBe('beta_code = 2');
      return found!;
    });
    const end = editor.view.state.doc.length;
    act(() => editor.view.dispatch({ changes: { from: end, insert: '\ntyped = 3' } }));
    controller.store?.flush();

    expect(beta.mainOf()).toBe('beta_code = 2\ntyped = 3');
    expect(alpha.mainOf()).toBe('alpha_code = 1');
    expect(alpha.patches).toHaveLength(0);
    controller.dispose();
  });
});

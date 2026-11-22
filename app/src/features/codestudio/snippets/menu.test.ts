// Inserting an example into a project whose file has the same name in other letter case (gap V2-9). Project paths
// are unique without regard to case (project/paths.ts), so `Main.py` and `main.py` are one file.
import { describe, expect, it } from 'vitest';
import { starterProject } from '../project/model';
import { EXAMPLES } from './examples';
import { exampleCollisions, examplePatch } from './menu';

describe('an example and a file named in other letter case', () => {
  it('sees the collision and replaces that file instead of adding a second one', () => {
    const example = EXAMPLES[0]!;
    const project = starterProject('One', 'print(0)');
    const main = project.main;
    const shouted = example.entry.toUpperCase();
    project.files[main] = { ...project.files[main]!, path: shouted, text: 'mine = 1' };

    expect(exampleCollisions(project, example)).toEqual([example.entry]);
    const { patch, entry } = examplePatch(project, example);
    expect(entry).toBe(main);
    // Only the existing file's text changes: no second file with the lowercase name.
    expect((patch.files as Record<string, unknown>)[main]).toEqual({ text: example.files[example.entry] });
  });
});

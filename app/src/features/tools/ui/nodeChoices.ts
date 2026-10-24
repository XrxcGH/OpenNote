// The notebooks and sections a tool can attach something to (an exam, a class). They are read through the notes
// service and kept current as notebooks change. Archived ones are left out.
import { useEffect, useState } from 'react';
import { useNotesIfAny } from '../../../services/notes';
import { nodeIndex } from '../../palette';

export interface NodeChoice {
  id: string;
  kind: 'notebook' | 'section';
  /** The name with its place, such as "Biology 101, Lectures". */
  label: string;
  notebookId: string;
  sectionId: string | null;
}

export function useNodeChoices(): readonly NodeChoice[] {
  // The tool windows draw in a root of their own, outside the notes provider, so this falls back to the running service.
  const notes = useNotesIfAny();
  const [choices, setChoices] = useState<readonly NodeChoice[]>([]);
  useEffect(() => {
    if (!notes) return undefined;
    let current = true;
    const load = () =>
      void nodeIndex(notes).then(
        (entries) => {
          if (!current) return;
          setChoices(
            entries
              .filter(
                (entry) => !entry.node.archived && (entry.node.kind === 'notebook' || entry.node.kind === 'section'),
              )
              .map((entry) => ({
                id: entry.node.id,
                kind: entry.node.kind as 'notebook' | 'section',
                label: [...entry.path, entry.node.title].join(', '),
                notebookId: entry.notebookId,
                sectionId: entry.node.kind === 'section' ? entry.node.id : null,
              })),
          );
        },
        () => undefined,
      );
    load();
    const stop = notes.watch(() => setTimeout(load, 0));
    return () => {
      current = false;
      stop();
    };
  }, [notes]);
  return choices;
}

// Settings, then Editing: the parts that Phase 4's packages register (typing, AutoCorrect, spelling, read aloud,
// paste, and history), in order. Each part draws its own heading and loads when the section first shows.
import { createElement, lazy, Suspense, useMemo } from 'react';
import type { ComponentType } from 'react';
import { isEnabled } from '../../../app/flags';
import { useRegistry } from '../../../registries';
import { editingSettingsParts } from '../registries';
import type { EditingSettingsPart } from '../registries';

const loaded = new Map<string, ComponentType>();

/** One lazy component per part, made once, so a part doesn't reload each time the section shows. */
function componentFor(part: EditingSettingsPart): ComponentType {
  let component = loaded.get(part.id);
  if (!component) {
    component = lazy(part.load);
    loaded.set(part.id, component);
  }
  return component;
}

export default function EditingSection() {
  const all = useRegistry(editingSettingsParts);
  const parts = useMemo(
    () => all.filter((part) => !part.flag || isEnabled(part.flag)).sort((a, b) => a.order - b.order),
    [all],
  );
  return (
    <>
      {parts.map((part) => (
        <Suspense key={part.id} fallback={null}>
          {createElement(componentFor(part))}
        </Suspense>
      ))}
    </>
  );
}

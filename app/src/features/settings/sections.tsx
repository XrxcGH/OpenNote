// The sections Settings shows: the registry's entries whose flags are on, in order, each loaded when first shown.

import { createElement, lazy, Suspense, useMemo } from 'react';
import type { ComponentType } from 'react';
import { isEnabled } from '../../app/flags';
import { settingsSections, useRegistry } from '../../registries';
import type { SettingsSectionDef } from '../../registries/types';

const loaded = new Map<string, ComponentType>();

/** One lazy component per section, made once, so a section doesn't reload each time it shows. */
function componentFor(section: SettingsSectionDef): ComponentType {
  let component = loaded.get(section.id);
  if (!component) {
    component = lazy(section.load);
    loaded.set(section.id, component);
  }
  return component;
}

export function useSections(): SettingsSectionDef[] {
  const all = useRegistry(settingsSections);
  return useMemo(
    () => all.filter((section) => !section.flag || isEnabled(section.flag)).sort((a, b) => a.order - b.order),
    [all],
  );
}

export function SectionBody({ section }: { section: SettingsSectionDef }) {
  return <Suspense fallback={null}>{createElement(componentFor(section))}</Suspense>;
}

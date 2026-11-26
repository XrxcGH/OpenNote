// A bar item's component that loads on first use, so the Home tab's controls stay out of the start-up bundle. Until
// it loads, a blank box of the control's width holds its place.
import { Suspense, createElement, lazy } from 'react';
import type { ComponentType } from 'react';
import type { CommandBarComponentProps } from '../../../registries/types';

export function lazyTool(
  load: () => Promise<ComponentType<never>>,
  fallbackWidth: number,
  extra: Record<string, unknown> = {},
): ComponentType<CommandBarComponentProps> {
  const Loaded = lazy(() =>
    load().then((component) => ({ default: component as ComponentType<Record<string, unknown>> })),
  );
  return function LazyTool(props: CommandBarComponentProps) {
    const blank = createElement('span', {
      style: { display: 'inline-block', inlineSize: fallbackWidth },
      'aria-hidden': true,
    });
    return createElement(Suspense, { fallback: blank }, createElement(Loaded, { ...props, ...extra }));
  };
}

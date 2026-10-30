// One title bar item in its wrapper. An item that says it is hidden (`useVisible`) renders no wrapper at all, so the
// bar's gap doesn't leave an empty space where it would be.

import type { TitleBarItemDef } from '../../registries/types';

const useAlways = () => true;

export function ItemSlot(props: { item: TitleBarItemDef; className?: string; presentation: 'full' | 'icon' }) {
  const { item, className, presentation } = props;
  const useVisible = item.useVisible ?? useAlways;
  if (!useVisible()) return null;
  const { Component } = item;
  return (
    <span className={className}>
      <Component presentation={presentation} />
    </span>
  );
}

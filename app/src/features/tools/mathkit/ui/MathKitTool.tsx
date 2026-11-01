// The engineering mathematics window: a tab for each tool, with arrow keys, Home and End to move between them. The
// tab that was last open comes back, and a command from the palette can pick one.
import '../text';
import { Suspense, useEffect, useRef, useState } from 'react';
import { t } from '../../../../strings/t';
import { followMathTab, savedMathTab, saveMathTab } from '../open';
import { MATH_TOOLS } from '../meta';
import { PANELS } from './panels';
import styles from './mathkit.module.css';

const current = (): string => {
  const saved = savedMathTab();
  return MATH_TOOLS.some((tool) => tool.id === saved) ? saved! : (MATH_TOOLS[0]?.id ?? '');
};

export function MathKitTool() {
  const [tab, setTab] = useState(current);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => followMathTab(() => setTab(current())), []);
  const pick = (id: string, focus = false) => {
    setTab(id);
    saveMathTab(id);
    if (focus) list.current?.querySelector<HTMLElement>(`[data-tab="${id}"]`)?.focus();
  };
  const onKey = (event: React.KeyboardEvent) => {
    const at = MATH_TOOLS.findIndex((tool) => tool.id === tab);
    const last = MATH_TOOLS.length - 1;
    const to =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? (at + 1) % (last + 1)
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? (at + last) % (last + 1)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (to < 0) return;
    event.preventDefault();
    pick(MATH_TOOLS[to].id, true);
  };
  const Body = PANELS[tab];
  return (
    <div className={styles.tool}>
      <div ref={list} className={styles.tabs} role="tablist" aria-label={t('kitMath.tabs')} onKeyDown={onKey}>
        {MATH_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            role="tab"
            data-tab={tool.id}
            id={`kitmath-tab-${tool.id}`}
            aria-selected={tab === tool.id}
            aria-controls="kitmath-panel"
            tabIndex={tab === tool.id ? 0 : -1}
            className={styles.tab}
            onClick={() => pick(tool.id)}
          >
            {t(tool.title)}
          </button>
        ))}
      </div>
      <div id="kitmath-panel" role="tabpanel" aria-labelledby={`kitmath-tab-${tab}`} className={styles.panel}>
        {Body ? (
          <Suspense fallback={null}>
            <Body />
          </Suspense>
        ) : null}
      </div>
    </div>
  );
}

export default MathKitTool;

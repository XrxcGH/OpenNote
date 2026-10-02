import { useCallback, useEffect, useLayoutEffect, useState } from 'react';
import { flushSync } from 'react-dom';
// One module per icon: the package index loads every icon, which slows the dev server and tests.
import { MoonIcon } from '@phosphor-icons/react/dist/csr/Moon';
import { SunIcon } from '@phosphor-icons/react/dist/csr/Sun';
import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  applyPreference,
  isToggleShortcut,
  loadPreference,
  resolveTheme,
  savePreference,
  toggledPreference,
} from './theme/theme';
import type { ThemePreference } from './theme/theme';

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(() => loadPreference(window.localStorage));
  const [systemDark, setSystemDark] = useState(() => darkQuery().matches);

  useEffect(() => {
    const query = darkQuery();
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  // A layout effect, so the new theme is in place when flushSync returns inside a view transition.
  useLayoutEffect(() => {
    applyPreference(document.documentElement, preference);
  }, [preference]);

  useEffect(() => {
    savePreference(window.localStorage, preference);
    // Keeps the native title bar in step. Null hands the choice back to Windows (Match Windows).
    if (isTauri()) {
      getCurrentWindow()
        .setTheme(preference === 'system' ? null : preference)
        .catch(() => {});
    }
  }, [preference]);

  // Reads the latest preference, so quick repeated toggles never act on a stale theme.
  const toggle = useCallback(() => {
    const update = () =>
      flushSync(() => setPreference((current) => toggledPreference(resolveTheme(current, darkQuery().matches))));
    // Crossfades every surface; engines without view transitions (such as jsdom) switch at once.
    if (typeof document.startViewTransition === 'function') document.startViewTransition(update);
    else update();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isToggleShortcut(event)) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggle]);

  return { shown: resolveTheme(preference, systemDark), toggle };
}

export function App() {
  const { shown, toggle } = useTheme();
  const dark = shown === 'dark';
  return (
    <div className="app">
      <header className="title-bar">
        <span className="app-name">OpenNote</span>
        <button
          type="button"
          role="switch"
          className="icon-button"
          onClick={toggle}
          aria-checked={dark}
          aria-label="Dark mode"
          aria-keyshortcuts="Control+Shift+D"
          title="Dark mode (Ctrl+Shift+D)"
        >
          {/* Shows the current theme; Fill marks the switch as on (docs/BRAND.md sections 8 and 11). */}
          {dark ? <MoonIcon weight="fill" aria-hidden="true" /> : <SunIcon aria-hidden="true" />}
        </button>
      </header>
      <main className="desk">
        <article className="page">
          <h1>OpenNote</h1>
          <p>The app shell is running. Notebooks, pages, and ink arrive in the next phases.</p>
        </article>
      </main>
    </div>
  );
}

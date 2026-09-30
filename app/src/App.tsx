import { useEffect, useState } from 'react';
import { applyPreference, loadPreference, resolveTheme, savePreference, toggledPreference } from './theme/theme';
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

  useEffect(() => {
    applyPreference(document.documentElement, preference);
    savePreference(window.localStorage, preference);
  }, [preference]);

  const shown = resolveTheme(preference, systemDark);
  const toggle = () => setPreference(toggledPreference(shown));
  return { shown, toggle };
}

export function App() {
  const { shown, toggle } = useTheme();
  const label = shown === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  return (
    <div className="app">
      <header className="title-bar">
        <span className="app-name">OpenNote</span>
        <button
          type="button"
          className="icon-button"
          onClick={toggle}
          aria-label={label}
          title={`${label} (Ctrl+Shift+D)`}
        >
          {shown === 'dark' ? '☀' : '☾'}
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

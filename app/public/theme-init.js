// Applies the saved theme before the first paint, so the window never flashes the wrong colors.
// Loaded as a plain script (not a module) so it runs before the page renders.
try {
  const saved = localStorage.getItem('opennote.theme');
  if (saved === 'light' || saved === 'dark') document.documentElement.setAttribute('data-theme', saved);
} catch {
  // Storage unavailable: the CSS falls back to the system setting.
}

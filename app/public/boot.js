// Applies the boot payload's attributes before the first paint, so the window never flashes the wrong theme,
// size class, or zoom (ARCHITECTURE.md sections 4.6 and 9.2). Rust injects `window.__OPENNOTE_BOOT__` before any
// page script runs. A plain browser has none, and keeps the choice from the last visit in localStorage.
// Loaded as a plain script, not a module, so it runs before the page renders. The breakpoints repeat
// brand/tokens.json; boot.test.ts checks they match.
(function () {
  var root = document.documentElement;
  try {
    var boot = window.__OPENNOTE_BOOT__;
    if (!boot || boot.bootVersion !== 1) {
      var saved = localStorage.getItem('opennote.theme');
      if (saved === 'light' || saved === 'dark') root.setAttribute('data-theme', saved);
      return;
    }
    var appearance = boot.settings.appearance;
    root.setAttribute('data-theme', boot.resolvedTheme);
    if (boot.os.contrast) root.setAttribute('data-contrast', 'on');
    if (appearance.motion === 'reduce') root.setAttribute('data-motion', 'reduce');
    if (appearance.pageColor === 'paper') root.setAttribute('data-page-color', 'paper');
    root.style.setProperty('--zoom', String(boot.os.zoom));
    var density = appearance.density;
    if (density !== 'mouse' && density !== 'touch') {
      density = window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? 'touch' : 'mouse';
    }
    root.setAttribute('data-density', density);
    var width = window.innerWidth;
    var sizeClass = width >= 1200 ? 'wide' : width >= 840 ? 'expanded' : width >= 600 ? 'medium' : 'compact';
    root.setAttribute('data-size-class', sizeClass);
  } catch {
    // Without storage or a payload the CSS falls back to the system setting.
  }
})();

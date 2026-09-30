// The installed browser that component and Playwright tests drive. Tests never download browsers: Windows uses
// Microsoft Edge, whose engine matches WebView2, and Linux uses Google Chrome, which GitHub's Ubuntu runners
// include. OPENNOTE_BROWSER_CHANNEL overrides it, for example with "chrome" on Windows.

export type BrowserChannel = 'msedge' | 'chrome' | 'chromium';

export function browserChannel(): BrowserChannel {
  const forced = process.env.OPENNOTE_BROWSER_CHANNEL;
  if (forced === 'msedge' || forced === 'chrome' || forced === 'chromium') return forced;
  return process.platform === 'win32' ? 'msedge' : 'chrome';
}

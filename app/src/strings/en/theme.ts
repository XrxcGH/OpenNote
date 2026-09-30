// The theme toggle, theme menu, theme cards, zoom, and the Appearance section.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const theme = {
  darkMode: 'Dark mode',
  commands: {
    toggle: 'Toggle dark mode',
    light: 'Use the light theme',
    dark: 'Use the dark theme',
    system: 'Match the Windows theme',
    openAppearance: 'Open appearance settings',
    zoomIn: 'Zoom in',
    zoomOut: 'Zoom out',
    zoomReset: 'Actual size',
  },
  keywords: {
    theme: 'theme color light dark night appearance',
    zoom: 'zoom text size bigger smaller magnify',
  },
  choices: {
    light: 'Light',
    dark: 'Dark',
    system: 'Match Windows',
  },
  captions: {
    light: 'Always light',
    dark: 'Always dark',
    system: 'Follows Windows',
  },
  menu: {
    label: 'Theme',
    appearance: 'Appearance settings',
  },
  toggle: {
    following: 'Following Windows. Right-click, long press, or press Shift+F10 for Light, Dark, or Match Windows.',
    choices: 'Right-click, long press, or press Shift+F10 for Light, Dark, or Match Windows.',
  },
  announce: {
    dark: 'Dark theme',
    light: 'Light theme',
    followingDark: 'Dark theme, following Windows',
    followingLight: 'Light theme, following Windows',
    leftWindowsDark: 'Dark theme, no longer following Windows.',
    leftWindowsLight: 'Light theme, no longer following Windows.',
    textSize: 'Text size {size}%',
  },
  contrastNote: 'A Windows contrast theme is on, so Windows sets the colors.',
  contrastNoteLater: "A Windows contrast theme is on, so Windows sets the colors. Your choice applies when it's off.",
} as const;

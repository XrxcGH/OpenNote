// The theme toggle, theme menu, theme cards, zoom, and the Appearance section.
// Every interface string is a full sentence here, never joined from pieces (ARCHITECTURE.md section 19).

export const theme = {
  darkMode: 'Dark mode',
  commands: {
    toggle: 'Toggle dark mode',
  },
  announce: {
    dark: 'Dark theme',
    light: 'Light theme',
    followingDark: 'Dark theme, following Windows',
    followingLight: 'Light theme, following Windows',
    leftWindowsDark: 'Dark theme, no longer following Windows.',
    leftWindowsLight: 'Light theme, no longer following Windows.',
  },
  contrastNote: 'A Windows contrast theme is on, so Windows sets the colors.',
} as const;

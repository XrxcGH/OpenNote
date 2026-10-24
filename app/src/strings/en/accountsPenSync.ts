// Pen settings sync across devices.

export const accountsPenSync = {
  commands: {
    sync: 'Sync pen settings across my devices',
    off: 'Stop syncing pen settings on this device',
    keywords: 'pen settings sync colors toolbar draw bar devices cloud google microsoft',
  },
  pick: {
    title: 'Where should pen settings be kept?',
    description:
      'OpenNote keeps a small file in a hidden folder that only OpenNote can see. Your other devices read it from the same account.',
    confirm: 'Use this account',
  },
  working: 'Syncing pen settings with {service}…',
  upToDate: 'Pen settings already match your other devices.',
  done: 'Pen settings synced. {pushed} sent, {pulled} received.',
  off: 'Pen settings are no longer synced on this device. The file in your account stays, and your other devices keep using it.',
} as const;

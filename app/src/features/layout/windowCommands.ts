// The window commands (ARCHITECTURE.md sections 10.3 and 10.7), for the palette. The native caption buttons do the
// same, and Alt+Space opens the real system menu, because WebView2 can swallow Alt+Space while it has focus.
// Close goes through the exit handshake.

import { chord, defineCommand } from '../../commands/registry';
import type { CommandDef } from '../../commands/types';

export const WINDOW_COMMANDS: readonly CommandDef[] = [
  defineCommand({
    id: 'window.minimize',
    title: 'titleBar.commands.minimize',
    category: 'view',
    allowInModal: true,
    run: (ctx) => ctx.platform.window.minimize(),
  }),
  defineCommand({
    id: 'window.toggleMaximize',
    title: 'titleBar.commands.toggleMaximize',
    category: 'view',
    allowInModal: true,
    checked: (ctx) => ctx.platform.window.isMaximized(),
    run: (ctx) => ctx.platform.window.toggleMaximize(),
  }),
  defineCommand({
    id: 'window.close',
    title: 'titleBar.commands.close',
    category: 'general',
    allowInModal: true,
    run: (ctx) => ctx.platform.window.close(),
  }),
  defineCommand({
    id: 'window.systemMenu',
    title: 'titleBar.commands.systemMenu',
    category: 'view',
    keys: [chord('Alt+Space')],
    customizable: false,
    allowInTextInput: true,
    allowInModal: true,
    run: (ctx) => ctx.platform.window.showSystemMenu(null),
  }),
];

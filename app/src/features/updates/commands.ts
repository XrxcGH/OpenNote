// The update commands (ARCHITECTURE.md section 18.11). The palette shows "Check for updates", "Restart to update"
// when an update is ready, and "Go back to the previous version" when a checked copy is kept. The chip, the
// popover, the Updates section, and the notices run the rest through executeCommand, which reports failures.

import { defineCommand } from '../../commands/registry';
import type { CommandContext } from '../../commands/types';
import { commands } from '../../registries';
import { getUpdaterStatus } from '../../state/updater';
import { t } from '../../strings/t';
import { confirm } from '../../ui';
import { canCheck, checkIsOffered } from './model';

const phase = () => getUpdaterStatus().phase;

/** Asks before going back, with focus on Cancel, and goes back when the person confirms. */
export async function confirmGoBack(ctx: CommandContext): Promise<void> {
  const previous = getUpdaterStatus().previous;
  if (!previous?.available) return;
  const confirmed = await confirm({
    title: t('updates.goBack.title', { version: previous.version }),
    body: t('updates.goBack.body'),
    confirmLabel: t('updates.goBack.confirm'),
  });
  if (confirmed) await ctx.platform.updater.goBack();
}

function registerPaletteCommands(): void {
  commands.register(
    defineCommand({
      id: 'updates.check',
      title: 'updates.commands.check',
      category: 'updates',
      when: () => checkIsOffered(phase()),
      enabled: () => canCheck(phase()),
      run: (ctx) => ctx.platform.updater.check(),
    }),
  );
  commands.register(
    defineCommand({
      id: 'updates.restart',
      title: 'updates.commands.restart',
      category: 'updates',
      when: () => phase().kind === 'ready',
      enabled: () => {
        const current = phase();
        return current.kind === 'ready' && current.blockedBy === null;
      },
      run: (ctx) => ctx.platform.updater.restartToUpdate(),
    }),
  );
  commands.register(
    defineCommand({
      id: 'updates.goBack',
      title: 'updates.commands.goBack',
      category: 'updates',
      when: () => getUpdaterStatus().previous?.available === true,
      run: confirmGoBack,
    }),
  );
  commands.register(
    defineCommand({
      id: 'updates.download',
      title: 'updates.commands.download',
      category: 'updates',
      when: () => phase().kind === 'available',
      run: (ctx) => ctx.platform.updater.download(),
    }),
  );
}

function registerActionCommands(): void {
  commands.register(
    defineCommand<string>({
      id: 'updates.skip',
      title: 'updates.commands.skip',
      category: 'updates',
      palette: false,
      run: (ctx, version) => ctx.platform.updater.skip(version),
    }),
  );
  commands.register(
    defineCommand({
      id: 'updates.unskip',
      title: 'updates.commands.unskip',
      category: 'updates',
      palette: false,
      when: () => getUpdaterStatus().skippedVersion !== null,
      run: (ctx) => ctx.platform.updater.unskip(),
    }),
  );
  commands.register(
    defineCommand<string>({
      id: 'updates.whatsNew',
      title: 'updates.commands.whatsNew',
      category: 'updates',
      palette: false,
      run: (ctx, version) => ctx.platform.shell.openExternal({ kind: 'releasePage', version }),
    }),
  );
  commands.register(
    defineCommand({
      id: 'updates.report',
      title: 'updates.commands.report',
      category: 'updates',
      palette: false,
      run: (ctx) => ctx.platform.shell.openExternal({ kind: 'newIssue', template: 'rollback' }),
    }),
  );
  commands.register(
    defineCommand({
      id: 'updates.moveApp',
      title: 'updates.commands.moveApp',
      category: 'updates',
      palette: false,
      run: (ctx) => ctx.platform.install.moveToUserPrograms(),
    }),
  );
}

export function registerUpdateCommands(): void {
  registerPaletteCommands();
  registerActionCommands();
}

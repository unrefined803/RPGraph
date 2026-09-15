import { expect, it } from 'vitest';
import { createWorkspaceProtection } from './workspaceProtection.cjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

it('blocks plain saves and different passwords until a new unprotected game is activated', () => {
  const policy = createWorkspaceProtection();
  expect(() => policy.require({ protection: 'plain' })).not.toThrow();
  policy.activate('game-secret');
  expect(() => policy.require({ protection: 'plain' })).toThrow('same game password');
  expect(() => policy.require({ protection: 'encrypted', password: 'other' })).toThrow();
  expect(() => policy.require({ protection: 'encrypted', password: 'game-secret' })).not.toThrow();
  policy.activate('next-game');
  expect(() => policy.require({ protection: 'encrypted', password: 'game-secret' })).toThrow();
  policy.activate('');
  expect(() => policy.require({ protection: 'plain' })).not.toThrow();
});

it.each(['workflow:save-named', 'storybook:save', 'character:save', 'file:save-to-path', 'workflow:save-current', 'session:save', 'session:save-current'])(
  '%s rejects a protection downgrade before performing file operations', async (channel) => {
    const main = readFileSync('electron/main.cjs', 'utf8');
    const start = main.indexOf(`ipcMain.handle('${channel}'`);
    const end = main.indexOf('\n});', start) + 4;
    const policy = createWorkspaceProtection();
    policy.activate('secret');
    let handler!: (event: unknown, request: unknown) => Promise<unknown>;
    runInNewContext(main.slice(start, end), {
      ipcMain: { handle: (_channel: string, callback: typeof handler) => { handler = callback; } },
      workspaceProtection: policy,
    });
    await expect(handler({}, { protection: 'plain', password: '' })).rejects.toThrow('same game password');
  },
);

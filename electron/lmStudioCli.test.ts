import { describe, expect, it } from 'vitest';
import {
  lmStudioCliCommand,
  lmStudioCliExecOptions,
} from './lmStudioCli.cjs';

describe('LM Studio CLI resolution', () => {
  it('prefers the Windows lms.exe install path when it exists', () => {
    const command = lmStudioCliCommand({
      platform: 'win32',
      homeDir: 'C:\\Users\\testuser',
      exists: (filePath) => filePath === 'C:\\Users\\testuser\\.lmstudio\\bin\\lms.exe',
      pathLookup: () => undefined,
    });

    expect(command).toBe('C:\\Users\\testuser\\.lmstudio\\bin\\lms.exe');
    expect(lmStudioCliExecOptions(command, ['unload', '--all'], 'win32')).toEqual({
      command: 'C:\\Users\\testuser\\.lmstudio\\bin\\lms.exe',
      args: ['unload', '--all'],
      options: { timeout: 60000, windowsHide: true, shell: false },
    });
  });

  it('falls back to lms.cmd on Windows only when it resolves on PATH', () => {
    const command = lmStudioCliCommand({
      platform: 'win32',
      homeDir: 'C:\\Users\\testuser',
      exists: () => false,
      pathLookup: (name) => name === 'lms.cmd' ? 'C:\\Tools\\lms.cmd' : undefined,
    });

    expect(command).toBe('C:\\Tools\\lms.cmd');
    expect(lmStudioCliExecOptions(command, ['unload', '--all'], 'win32')).toEqual({
      command: 'C:\\Tools\\lms.cmd',
      args: ['"unload"', '"--all"'],
      options: { timeout: 60000, windowsHide: true, shell: true },
    });
  });

  it('preserves non-Windows lms command behavior', () => {
    const command = lmStudioCliCommand({
      platform: 'linux',
      homeDir: '/home/testuser',
      exists: () => false,
      pathLookup: () => undefined,
    });

    expect(command).toBe('lms');
    expect(lmStudioCliExecOptions(command, ['unload', '--all'], 'linux')).toEqual({
      command: 'lms',
      args: ['unload', '--all'],
      options: { timeout: 60000, windowsHide: true, shell: false },
    });
  });
});

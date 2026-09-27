const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const lmStudioCliTimeoutMs = 60 * 1000;

function quotedWindowsCliArgument(value) {
  if (/["%\r\n]/.test(value)) {
    throw new Error(`Unsupported character in LM Studio CLI argument: ${value}`);
  }
  return `"${value}"`;
}

function lookupOnPath(name) {
  const command = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(command, [name], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (result.status !== 0) {
    return undefined;
  }
  return String(result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function lmStudioCliCommand({
  platform = process.platform,
  homeDir = os.homedir(),
  exists = fsSync.existsSync,
  pathLookup = lookupOnPath,
} = {}) {
  if (platform !== 'win32') {
    return 'lms';
  }
  const homeInstall = path.join(homeDir, '.lmstudio', 'bin', 'lms.exe');
  if (exists(homeInstall)) {
    return homeInstall;
  }
  return (
    pathLookup('lms.exe') ||
    pathLookup('lms.cmd') ||
    'lms.exe'
  );
}

function lmStudioCliExecOptions(command, args = ['unload', '--all'], platform = process.platform) {
  const useShell = platform === 'win32' && /\.cmd$/i.test(command);
  return {
    command,
    args: useShell ? args.map(quotedWindowsCliArgument) : args,
    options: { timeout: lmStudioCliTimeoutMs, windowsHide: true, shell: useShell },
  };
}

module.exports = {
  lmStudioCliCommand,
  lmStudioCliExecOptions,
};

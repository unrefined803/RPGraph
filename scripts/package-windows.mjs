import { spawnSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const buildEnvironment = { ...process.env };

function run(command, args, env = buildEnvironment, timeout) {
  const result = spawnSync(command, args, { cwd: projectRoot, env, stdio: 'inherit', timeout });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Build command failed: ${path.basename(command)} (exit ${result.status ?? result.signal})`);
  }
}

async function buildInstaller() {
  if (!['linux', 'win32'].includes(process.platform)) {
    throw new Error('Build the Windows installer on Windows or an x86_64 Linux host.');
  }
  if (process.platform === 'linux') {
    if (process.arch !== 'x64') throw new Error('Linux cross-builds require an x86_64 Wine host.');
    const wine = spawnSync('wine', ['--version'], { encoding: 'utf8', timeout: 10_000 });
    if (wine.error || wine.status !== 0) {
      throw new Error('Working Wine is required on the build host. On Arch Linux: sudo pacman -S --needed wine');
    }
    // Keep packaging tools separate from the user's Wine applications. Disable
    // optional Mono/Gecko downloads and graphical Wine initialization dialogs.
    buildEnvironment.WINEPREFIX = path.join(projectRoot, 'node_modules', '.cache', 'rpgraph-wine');
    buildEnvironment.DISPLAY = '';
    buildEnvironment.WAYLAND_DISPLAY = '';
    buildEnvironment.WINEDEBUG = '-all';
    await mkdir(buildEnvironment.WINEPREFIX, { recursive: true });
    const initializationEnvironment = {
      ...buildEnvironment,
      WINEDLLOVERRIDES: 'mscoree,mshtml=d;winemenubuilder.exe=d',
    };
    run('wine', ['wineboot.exe', '--init'], initializationEnvironment, 300_000);
    // electron-builder supplies its own WINEDLLOVERRIDES. Persist these settings
    // in the dedicated prefix as well so subsequent tool launches keep them.
    for (const dll of ['mscoree', 'mshtml']) {
      run('wine', ['reg.exe', 'add', 'HKCU\\Software\\Wine\\DllOverrides',
        '/v', dll, '/d', '', '/f'], initializationEnvironment, 60_000);
    }
  }
  const npmCli = process.env.npm_execpath;
  if (!npmCli) throw new Error('Run this build through npm run package:windows.');
  run(process.execPath, [npmCli, 'run', 'build']);
  run(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'),
    '--config', 'dev/config/electron-builder.yml', '--win', 'nsis', '--x64', '--arm64', '--publish', 'never']);
  run(process.execPath, [path.join(projectRoot, 'scripts', 'verify-windows-package.mjs')]);
}

buildInstaller().catch((error) => {
  console.error(`Windows installer build failed: ${error.message}`);
  process.exitCode = 1;
});

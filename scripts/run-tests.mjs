import { spawn } from 'node:child_process';
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const [runner, ...args] = process.argv.slice(2);
const entrypoints = {
  vitest: 'vitest/package.json',
  playwright: '@playwright/test/cli',
};

if (!Object.hasOwn(entrypoints, runner)) {
  throw new Error('Choose the vitest or playwright test runner.');
}

// Interactive sessions and informational commands need their normal output.
const interactive = args.some((arg) =>
  ['--watch', '-w', '--ui', '--debug', '--help', '-h', '--version', '-v', '--list', 'list'].includes(arg),
) || process.env.PWDEBUG === '1';
const verbose = interactive || process.env.RPGRAPH_TEST_VERBOSE === '1';
const resolvedEntrypoint = require.resolve(entrypoints[runner]);
const entrypoint = runner === 'vitest'
  ? join(dirname(resolvedEntrypoint), require('vitest/package.json').bin.vitest)
  : resolvedEntrypoint;
const logDirectory = verbose ? undefined : mkdtempSync(join(tmpdir(), 'rpgraph-tests-'));
const logPath = logDirectory && join(logDirectory, 'output.log');
const logFd = logPath ? openSync(logPath, 'w') : undefined;

let interrupted;
let child;
const forwardSignal = (signal) => {
  interrupted = signal;
  child?.kill(signal);
};
const onInterrupt = () => forwardSignal('SIGINT');
const onTerminate = () => forwardSignal('SIGTERM');
process.on('SIGINT', onInterrupt);
process.on('SIGTERM', onTerminate);

try {
  const result = await new Promise((resolve, reject) => {
    child = spawn(process.execPath, [entrypoint, ...args], {
      stdio: verbose ? 'inherit' : ['inherit', logFd, logFd],
    });
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (result.code === 0 && !result.signal && !interrupted) {
    if (!verbose) console.log('Tests passed.');
    process.exitCode = 0;
  } else {
    if (logPath) process.stderr.write(readFileSync(logPath));
    console.error(`Tests failed${result.signal || interrupted ? ` (${result.signal || interrupted})` : ''}.`);
    process.exitCode = result.code || (interrupted === 'SIGINT' ? 130 : 1);
  }
} catch (error) {
  if (logPath) process.stderr.write(readFileSync(logPath));
  console.error(`Could not run tests: ${error.message}`);
  process.exitCode = 1;
} finally {
  process.removeListener('SIGINT', onInterrupt);
  process.removeListener('SIGTERM', onTerminate);
  if (logFd !== undefined) closeSync(logFd);
  if (logDirectory) rmSync(logDirectory, { recursive: true, force: true });
}

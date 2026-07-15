import { execSync } from 'node:child_process';

// Install the repo's git hooks by pointing git at the tracked `.githooks`
// directory. Runs via the `prepare` npm script on `npm install`. Safe no-op when
// not inside a git work tree (e.g. installed as a dependency, or `npm ci` in a
// non-repo context) or when git is unavailable.
try {
  const insideWorkTree = execSync('git rev-parse --is-inside-work-tree', {
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
  if (insideWorkTree === 'true') {
    execSync('git config core.hooksPath .githooks', { stdio: 'ignore' });
  }
} catch {
  // Not a git work tree, or git is unavailable — nothing to install.
}

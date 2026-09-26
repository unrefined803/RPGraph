# Dependency maintenance

Use `npm ci` to reproduce the committed dependency tree and `npm audit` to
check it against current advisories. Deprecation notices and security advisories
are separate: a clean audit does not mean every dependency is maintained.

## September 2026 update

The lockfile updates dependencies within their existing version ranges, including
React 19.3, React Flow 12.12, Vite 7.3.6, Playwright 1.63, ESLint 10.11, and
TypeScript ESLint 8.70.1. esbuild is pinned to 0.28.2 consistently in the direct
dependency, override, and install-script allowlist. The smol-toml security update
to 1.9.0 is retained.

The override scoped to `@electron/get@3.1.0` selects `global-agent@4.1.3`.
This removes the deprecated `boolean` dependency and its old logging dependency
chain. The downloader uses `require('global-agent').bootstrap()`, which remains
available; initialization with proxy and bypass environment variables was checked.
Remove this override when electron-builder adopts a downloader that no longer
needs it. See the [global-agent release notes](https://github.com/gajus/global-agent/releases).

## Remaining deprecations

electron-builder 26.15.3 still brings in these dependencies:

- `@electron/asar@3.4.1` uses `glob@7`, which uses `inflight`.
- The Squirrel Windows packaging dependency uses `electron-winstaller`, then
  `temp@0.9.4`, then `rimraf@2`, which also uses `glob@7` and `inflight`.

Do not force modern glob or rimraf versions into these packages: their consumers
expect the old callable/callback APIs. Updating ASAR alone cannot remove the
remaining temp/rimraf chain. Keep installation warnings visible until compatible
upstream updates or a separately validated packaging migration resolve them.

## Deferred migrations

Knip is pinned to 6.24.0. Version 6.38.0 reports 41 unused exports and 16 unused
exported types with the existing configuration; evaluate those findings in a
separate cleanup before raising the pin.

New major versions are available for Electron, Vite and its React plugin,
TypeScript, Vitest and its coverage provider, TOON, concurrently, and wait-on.
Migrate these separately, checking release notes and the affected workflows.
Keep Node type definitions aligned with the project's Node 24 baseline.

Validate dependency changes with a clean install, `npm run build`, `npm run lint`,
`npm run check:unused`, and `npm run --silent test`. The user validates the
application interface; automated checks alone cannot guarantee runtime behavior.

# Dependency maintenance

Use `npm ci` to reproduce the committed dependency tree and `npm audit` to
check it against current advisories. Deprecation notices and security advisories
are separate: a clean audit does not mean every dependency is maintained.

## September 2026 update

The lockfile updates dependencies within their existing version ranges, including
React 19.3, React Flow 12.12, Vite 7.3.6, Playwright 1.63, ESLint 10.11, and
TypeScript ESLint 8.70.1. esbuild is pinned to 0.28.2 in the direct
dependency and install-script allowlist. The smol-toml security update
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

New major versions remain to be evaluated for Electron, TypeScript, TOON,
concurrently, and wait-on.
Migrate these separately, checking release notes and the affected workflows.
Keep Node type definitions aligned with the project's Node 24 baseline.

Validate dependency changes with a clean install, `npm run build`, `npm run lint`,
`npm run check:unused`, and `npm run --silent test`. The user validates the
application interface; automated checks alone cannot guarantee runtime behavior.

## Major upgrade, stage 1: build and test tools

Completed on September 26, 2026. Pause after this stage for the user's manual
interface check before migrating the remaining package groups.

| Package | Previous installed version | Stage 1 version |
| --- | --- | --- |
| Vite | 7.3.6 | 8.3.1 |
| @vitejs/plugin-react | 5.2.0 | 6.1.1 |
| Vitest | 4.1.11 | 5.0.2 |
| @vitest/coverage-v8 | 4.1.11 | 5.0.2 |

Registry metadata confirmed these stable releases and compatible peer ranges:
the React plugin requires Vite 8, Vitest supports Vite 6.4/7/8, and its coverage
provider requires the matching Vitest version. Node 24.21.0 and @types/node
24.19.0 satisfy their requirements and remain unchanged.

Reviewed the official [Vite migration guide](https://vite.dev/guide/migration),
[React plugin 6 release notes](https://github.com/vitejs/vite-plugin-react/releases/tag/plugin-react%406.0.0),
and [Vitest 5 migration guide](https://vitest.dev/guide/migration/).
Vite now uses Rolldown/Oxc; the vendor chunk selector uses
`build.rolldownOptions.output.codeSplitting` while retaining the React and React
Flow chunk groups. The custom development transform for shared CommonJS modules
is retained. No Babel customization needs migration. Both tool configurations
now use `.mts`, with their script, TypeScript, ESLint, and Knip references updated,
so Vite recognizes their ESM format without its native-loader warning.

esbuild 0.28.2 remains necessary for the Character Container scripts. Its global
override was removed: the direct exact version also satisfies Vite's optional
peer dependency, and `npm ls esbuild` confirms a single deduplicated version.
The downloader override and existing install-script allowlist remain unchanged.
Vitest's new defaults pass the existing tests without compatibility switches.

Validation: the baseline build, lint, unused-code check, and full non-UI tests
passed. After migration, clean `npm ci`, `npm audit` (zero vulnerabilities),
build including `tsc -b`, lint, the pinned Knip check, full non-UI tests, and V8
coverage passed. Coverage artifacts are in `/tmp/rpgraph-upgrade-coverage`.
`npm run package:linux -- --publish never` also passed and produced
`release/RPGraph-Studio-0.6.0-x86_64.AppImage` using the unchanged Electron
41.10.7. The sandbox initially blocked the Electron download with a DNS error;
the approved network-enabled retry completed successfully. Packaging also
reported duplicate dependency references; it did not fail the build.
The production build processes the existing glob imports, shared CommonJS
modules, lazy node modules, bundled characters, and image/font/audio assets.
This does not replace runtime validation of their loading and rendering.

Manual checkpoint: start development mode, open an existing workflow, add and
connect nodes, open a bundled character and Storybook, check images/fonts/audio,
and run a familiar workflow. Repeat key loading/navigation actions in the Linux
AppImage to exercise the production chunks. No application, browser, or UI/E2E
test was launched during this stage.

Next stages: TypeScript and its lint compatibility; Electron and start tools
with another AppImage check; TOON compatibility; then the individual Knip
findings. Recheck electron-builder upstream updates with the Electron stage.
Its existing glob/inflight/rimraf deprecations remain visible during `npm ci`;
no incompatible transitive major overrides were introduced.

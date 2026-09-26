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

The TOON major upgrade remains to be evaluated.
TypeScript 7 is deferred pending compatible typescript-eslint support; stage 2
uses the supported TypeScript 6 line.
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

## Major upgrade, stage 2: TypeScript

The user confirmed that stage 1 works in the interface. Stage 2 updates
TypeScript from 5.9.3 to 6.0.3, using `~6.0.3` to stay within the supported
minor line. Node 24 and @types/node 24.19.0 remain unchanged.

Registry metadata lists 7.0.2 as the latest stable TypeScript, but the latest
stable typescript-eslint and its parser (8.70.1) require
`typescript >=4.8.4 <6.1.0`. TypeScript 6.0.3 is the latest stable release within
that range. Keep TypeScript 7 deferred until the lint tools support it; do not
bypass peer checks or suppress unsupported-version warnings. The existing
typescript-eslint version needs no update.

Reviewed the official [TypeScript 6 release notes](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-6-0.html)
and [typescript-eslint dependency requirements](https://typescript-eslint.io/users/dependency-versions/).
TypeScript 6 defaults `types` to an empty list. Add `types: ["node"]` to
`tsconfig.app.json` because its existing `src` include also checks Node-based
unit tests. This fixes unresolved Node built-ins and globals and the resulting
inference errors without weakening checks. The Electron test project already
declares Node types. Project references, `tsc -b`, strict checking, and
`noEmit` remain in place; no application code changes were needed.

Validation after clean `npm ci`: `npm run build` (all three referenced
TypeScript projects and Vite production build), `npm run lint`,
`npm run check:unused`, and `npm run --silent test` passed. `npm ls typescript`
confirms one deduplicated 6.0.3 compiler across the lint tools. `npm audit`
reports zero vulnerabilities. The existing packaging deprecation warnings
remain unchanged. No application, browser, or UI/E2E tests were started, and
the AppImage was not rebuilt in this compiler-only stage.

An optional manual smoke check is to open an existing workflow and run it.
This stage does not claim a runtime performance improvement. Next is the
Electron and start-tool migration, including a fresh Linux AppImage build and
manual runtime validation.

## Major upgrade, stage 3: Electron and launch tools

The user confirmed stage 2 works and deferred AppImage building and testing.

| Package | Previous installed version | Stage 3 version |
| --- | --- | --- |
| Electron | 41.10.7 | 44.4.5 |
| concurrently | 9.2.4 | 10.0.5 |
| wait-on | 8.0.5 | 9.1.0 |

Registry metadata confirms stable releases compatible with host Node 24:
Electron requires Node >=22.12, concurrently >=22, and wait-on >=20.
Node type definitions remain on the 24 line.

Reviewed [Electron breaking changes for 42–44](https://www.electronjs.org/docs/latest/breaking-changes),
[concurrently 10 changes](https://github.com/open-cli-tools/concurrently/releases/tag/v10.0.0),
and [wait-on releases](https://github.com/jeffbski/wait-on/releases).
The main process and preload do not use the removed Electron clipboard APIs,
offscreen rendering, extension frames, or Node-integrated subframe workers.
Existing context isolation, IPC wrappers, window controls, and the launcher
remain compatible at the source level; runtime validation is still required.
Linux frameless windows can now have rounded corners, and file dialogs without
an explicit default path start in Downloads. Existing explicit image/workflow/
character dialog paths remain in place. Electron 44 requires macOS 13+ and
no longer supplies Windows ia32 or Linux armv7l binaries.

Electron no longer has a postinstall script. Remove its obsolete `allowScripts`
entry; keep the esbuild and electron-winstaller entries. The existing launcher
imports Electron's executable path, whose resolver now downloads the binary
when needed. After clean installation, `node node_modules/electron/install.js`
successfully downloaded the binary without launching it; its installed version
file confirms 44.4.5. Future clean installs may download it on first launch.
concurrently is ESM-only, but this project uses its CLI; the existing `-k` and
wait-on TCP command syntax remain supported.

Validation: clean `npm ci`, `npm audit` (zero vulnerabilities), production build,
lint, Knip, and the complete non-UI tests passed. Launcher/main/preload syntax
checks passed. An isolated concurrently CLI check verified that one completed
Node child terminates its sibling via `-k`; wait-on successfully detected an
existing file. These checks did not start the application or a development
server and do not replace the user's desktop startup test.

electron-builder 26.15.3 is still the latest stable release. It still requires
the scoped @electron/get 3.1.0/global-agent 4.1.3 override, while Electron itself
now uses @electron/get 5.1.0. The existing glob/inflight/rimraf warnings remain.
Recheck compatible electron-builder updates before the deferred packaging
validation; do not force incompatible transitive major versions.

Manual checkpoint: restart the desktop app, load and save a workflow, check
provider requests/streaming, file dialogs, window controls, graph dragging and
zooming, then close the app and check that development processes terminate.
No Electron process, browser, or UI/E2E test was started. AppImage build and
validation are explicitly deferred at the user's request; any existing AppImage
is from the previous Electron version. Next stages are TOON and Knip.

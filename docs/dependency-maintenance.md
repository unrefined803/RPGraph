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

electron-builder 26.15.3 still brings in these dependencies. The stage 6
investigation below reconfirmed them; no warning has been resolved yet:

- `@electron/asar@3.4.1` uses `glob@7`, which uses `inflight`.
- `@electron/universal@2.0.3` also requires ASAR 3.
- The Squirrel Windows packaging dependency uses `electron-winstaller`, then
  `temp@0.9.4`, then `rimraf@2`, which also uses `glob@7` and `inflight`.

Do not force modern glob or rimraf versions into these packages: their consumers
expect the old callable/callback APIs. Updating ASAR alone cannot remove the
remaining temp/rimraf chain. Keep installation warnings visible until compatible
upstream updates or a separately validated packaging migration resolve them.

## Deferred migrations

Knip is pinned to 6.38.0 after the individually reviewed cleanup in stage 5.

TOON 4 compatibility is completed in stage 4 below.
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


## Major upgrade, stage 4: TOON

Updated `@toon-format/toon` from 2.3.1 to stable 4.1.1. Reviewed the official
[TOON 4 breaking changes](https://github.com/toon-format/toon/releases/tag/v4.0.0)
and [subsequent fixes](https://github.com/toon-format/toon/releases).
TOON 4 removes key folding and path expansion. Context and diagnostic exports
now encode nested data directly, and their roundtrip tests use the default
decoder. New exports may use keyed tables and nested field groups; token counts
and prompt text can therefore differ. Existing saved workflows and structured
Character Stats state require no migration. Old diagnostic exports are not an
application import format; external consumers of folded TOON 2 exports still
need a compatible decoder for those historical files.

All direct encode/decode callers were reviewed: context formatting, diagnostics,
speaker prompts/results, and Character Stats initialization/patching. Added
regressions for nested context, literal dotted keys, comment-like strings,
legacy speaker arrays and fences, empty dialogue, malformed row counts, and
Character Stats init/patch/keep across persisted state, including keyed tables.
The existing empty-dialogue compatibility handling remains in place.

Regression testing also exposed a pre-existing speaker JSON fallback bug:
both TOON 2.3.1 and 4.1.1 decode a JSON object as a literal TOON key rather than
throwing. Object-shaped responses now try JSON first, preserving the intended
fallback without relaxing TOON validation.

Validation: clean `npm ci`, production build, lint, Knip 6.24.0, all non-UI tests,
and `npm audit` (zero vulnerabilities) passed. Initial sandbox registry access
failed; approved network-enabled installation succeeded. The three packaging
deprecations remain. No application, browser, UI/E2E test, or AppImage was run.
The user reported a successful application test during this stage and authorized
continuing to Knip. That report preceded the final automated checks and should
not be treated as a dedicated test of every new regression case.

Manual follow-up: run speaker highlighting in TOON mode, initialize and update
Character Stats, reload a saved workflow, and inspect/copy TOON in Debug Snapshot
and Turn Trace. AppImage validation remains deferred.


## Upgrade, stage 5: Knip and unused exports

Updated the exact Knip pin from 6.24.0 to stable 6.38.0 after checking registry
metadata and the official [release notes](https://github.com/webpro-nl/knip/releases).
Its Node requirement (`^20.19.0 || >=22.12.0`) includes the unchanged Node 24
baseline. Lockfile changes also update Knip's parser/resolver and related tooling
dependencies; other direct dependencies remain unchanged in this stage.

The initial report reproduced 41 unused value exports and 16 unused exported
types. Each name was checked for references across application code, scripts,
tests, Electron, and shared modules. Reviewed the registry and raw-source loader:
`codeResolver.ts` loads source as text for the Node Assistant, not as executable
exports. No dynamic API needed an exemption or removal.

- Keep 34 value declarations and seven types as module-private implementation
  details, including prompt templates, Storybook normalizers, layout constants,
  rendering helpers, and custom-node request types. Their behavior is unchanged.
- Remove seven unused value declarations: three obsolete Storybook wrappers,
  the unused registry predicate, the speaker prompt wrapper, and both exports
  of the unused WorkflowVariablePicker file. Remove that file and its now-unused
  `workflowVariableToken` helper; other workflow-variable parsing remains.
- Remove nine unused types, including the obsolete parallel generic node model.
  The active `NodeCreationDefinition`, `WorkflowNodeData`, and placeholder types
  remain. Update the node architecture reference accordingly.
- Remove the now-redundant `src/electron.d.ts` Knip ignore entry after Knip's
  configuration hint; retain the declaration file. Remove two obsolete ESLint
  suppressions now that the affected TSX modules only export components.

Validation after clean `npm ci`: production build, lint without warnings,
Knip without findings or configuration hints, and all non-UI tests passed.
`npm audit` reports zero vulnerabilities. Node 24, @types/node 24.19.0,
TypeScript 6.0.3, Electron, and packaging tools remain unchanged. Existing
inflight/glob/rimraf installation warnings persist; no warnings were hidden and
no incompatible overrides or peer bypasses were added.

Manual follow-up: open a saved workflow, check node cards and previews, open
Storybook settings and prompt-action configuration, and run a familiar workflow.
For Node Assistant users, also inspect the node-source context. The application,
Electron, browser, and UI/E2E tests were not launched. AppImage build/test stays
deferred. Remaining work is compatible upstream packaging updates for the three
deprecations, and TypeScript 7 once typescript-eslint supports it.

## Investigation, stage 6: packaging deprecations

Checked on September 26, 2026. The working tree was clean at the start; earlier
upgrade stages were already committed locally relative to `origin/main`.
`npm explain inflight glob rimraf` and `npm ls` confirmed both dependency chains
above, including the additional ASAR consumer `@electron/universal`.
The only explicitly configured packaging target is Linux AppImage x64 in
`dev/config/electron-builder.yml` and `package:linux`. Windows scripts launch the
application; they do not configure a Windows installer. Squirrel is nevertheless
installed through app-builder-lib's peer dependency. No target was removed.

Registry queries checked exact versions and dist-tags, not just `latest`:

| Package | Installed (retained) | Stable release checked | Remaining obstacle |
| --- | --- | --- | --- |
| electron-builder / app-builder-lib | 26.15.3 | 26.17.0 | app-builder-lib still pins ASAR 3.4.1 and universal 2.0.3 |
| @electron/asar | 3.4.1 | 4.3.1 | Outside all installed consumers' declared ranges; 3.4.1 is the last published 3.x version |
| @electron/universal | 2.0.3 | 3.0.6 | Uses ASAR 4, but is outside app-builder-lib's exact pin |
| electron-winstaller | 5.4.0 | 5.4.4 | Still requires ASAR ^3.2.1 and temp ^0.9.0 |
| temp | 0.9.4 | 0.9.4 | Still requires rimraf ~2.6.2 |

electron-builder's `latest` tag remains 26.15.3, while its `v26` tag and the
official [release list](https://github.com/electron-userland/electron-builder/releases)
identify stable 26.17.0. The `next` tag is 27.0.0-alpha.9 and was not considered
an eligible upgrade. Updating to 26.17.0 alone cannot meet this stage's goal.

### Compatibility and alternatives

The installed ASAR crawler promisifies `glob.glob`; temp invokes rimraf as a
function with a callback and also uses `rimraf.sync`, passing `maxBusyTries`.
These are concrete reasons not to override glob/rimraf with modern major versions.
electron-winstaller's `lib/temp-utils.js` calls `temp.track()` and promisifies
`temp.mkdir`; replacing directory creation alone would lose automatic cleanup.

[ASAR 4's migration notes](https://github.com/electron/asar/releases/tag/v4.0.0)
describe ESM-only exports, removal of default exports, and Node >=22.12.
Host Node 24 meets the engine requirement, but that does not establish consumer
compatibility. app-builder-lib dynamically imports `createPackageFromStreams`
and archive inspection APIs; electron-winstaller uses CommonJS to read archived
package metadata. universal 2's ESM `asar-utils.js` imports ASAR's default export.
A global ASAR override therefore needs consumer-specific validation and potentially
additional changes, and would still leave temp/rimraf installed.

- A postinstall source patch cannot remove installation warnings: npm has already
  resolved and installed the deprecated dependencies before that patch runs.
- A complete local fix would need reproducible replacement packages with changed
  dependency manifests, plus compatible ASAR traversal and temporary-directory
  cleanup implementations (or coordinated consumer upgrades). Maintaining those
  forks includes licenses, security updates, symlink/glob behavior, Windows file
  locking/retries, and exit cleanup. This is more than a small application patch.
- Replacing electron-builder would require reproducing ASAR handling, AppImage
  generation, resource inclusion, icons, desktop integration, and artifact naming.
  Keeping the `.AppImage` extension would not itself prove equivalent behavior;
  Windows installer support would need a separate decision and validation.

Decision: retain the current dependencies and visible warnings. No supported
stable update resolves both chains, and introducing maintained forks or a new
packaging tool solely for clean install output is disproportionate here. This is
an investigation outcome, not a completed deprecation fix. Revisit when stable
consumer releases support modern ASAR and replace temp's rimraf dependency.

Validation for this documentation-only stage: installed dependency inspection
passed and a fresh `npm audit` reported zero vulnerabilities. No dependency,
lockfile, override, install-script permission, or application code changed, so
`npm ci`, build, lint, Knip, and unit tests were not repeated. Node 24.21.0,
@types/node 24.19.0, TypeScript 6.0.3, and Electron 44.4.5 remain unchanged.
AppImage building/testing remains explicitly deferred; obtain the user's approval
before that step. No application, Electron process, browser, or UI test was run,
and Windows packaging compatibility was not validated.

When a packaging fix is available, validate a clean install without these notices,
the complete dependency tree, audit, build, lint, Knip, and non-UI tests. Then,
after approval to build the AppImage, have the user launch the new artifact and
check workflow loading/saving, bundled characters and Storybooks, images/audio,
provider streaming, file dialogs, and clean shutdown.

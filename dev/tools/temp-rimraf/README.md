# Temporary file cleanup adapter

`electron-builder` 26 installs `electron-winstaller`, which uses `temp` 0.9.4.
That version of `temp` depends on `rimraf` 2 and deprecated `glob` 7. The scoped
override in the root package manifest replaces only that cleanup dependency with
Node.js `fs.rm` / `fs.rmSync`, preserving callbacks, synchronous cleanup, missing
path handling, and `maxBusyTries` retries. `temp` supplies literal paths, so glob
expansion is intentionally unsupported.

The separate `@electron/asar` override upgrades the other glob 7 consumer to
version 4, which supports the project's Node.js 24 requirement.

Remove these overrides and this adapter when upstream dependencies no longer
require the old packages. Keep the integration tests in
`electron/packagingDependencies.test.ts` aligned with the installed consumers.

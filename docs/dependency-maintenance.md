# Dependency maintenance

`package.json` defines supported dependency ranges and overrides; `package-lock.json`
records the reproducible dependency tree. Use `npm ci` for a clean installation
and `npm audit` to check that tree against current advisories. Deprecation notices
and security advisories are separate.

## Toolchain

The project uses Node.js 24 or newer, TypeScript 6, Vite 8, Vitest 5,
Electron 44 and TOON 4. Node type definitions follow the Node 24 baseline.
Knip is pinned to 6.38.0. Check actual versions in the package manifest and lockfile
before changing dependencies; this document is not a registry release inventory.

TypeScript upgrades must remain compatible with typescript-eslint's declared peer
range. TOON callers encode nested data without key folding or path expansion.
Historical folded TOON exports require a compatible external decoder.

Vite uses `dev/config/vite.config.mts` with Rolldown code splitting and the shared
CommonJS development transform. The exact esbuild dependency supports the
Character Container scripts. Installation-script permissions are in `allowScripts`.
Electron's runtime resolver can download its binary on first use.

## Packaging compatibility overrides

- `@electron/asar` is overridden to 4.3.1.
- `temp@0.9.4` uses the local `dev/tools/temp-rimraf` adapter instead of its old
  rimraf dependency. The adapter supports literal-path callback and synchronous
  cleanup, including retries; it does not implement glob expansion.
- `@electron/get@3.1.0` uses `global-agent@4.1.3` for downloader proxy support.

See [the cleanup adapter](../dev/tools/temp-rimraf/README.md) and
`electron/packagingDependencies.test.ts` for the consumer compatibility boundary.
Review these overrides when changing packaging dependencies. Remove an override
only when the installed consumers no longer need it and compatibility checks pass.

## Validation

For dependency changes, run a clean install, `npm run build`, `npm run lint`,
`npm run check:unused`, and `npm run --silent test`. Use `npm audit` for current
advisory results; do not treat a past clean result as a current security status.

Packaging changes also require the relevant artifact build and verification:
[Linux AppImage](linux-appimage.md) and [Windows installer](windows-installer.md).
The user performs desktop startup and interface validation.

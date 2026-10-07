# Linux AppImage

RPGraph Studio builds a portable **Linux x86_64 AppImage** with the version from
`package.json`. Electron, the compiled interface, default content, NPC characters,
and ComfyUI workflow templates are included. Node.js and the source checkout are
only needed to build it, not to run the result.

The build pins electron-builder's **static AppImage runtime toolset 1.0.3**.
Its FUSE library is included in the executable, so users do not need to install
`fuse2` or `libfuse.so.2`. The runtime can use the system's `fusermount3` helper.
See the [AppImage runtime documentation](https://github.com/AppImage/type2-runtime).

## Build

Use a Linux x86_64 machine with Node.js 24 or newer and npm. From the repository root:

```bash
npm ci
npm run package:linux
```

The Linux starter also offers **8) Build Linux AppImage**. The first build needs
network access to download Electron and electron-builder's packaging tools.
Downloads are cached outside the repository. Do not run the build with `sudo`.

The command builds the renderer, packages the application, and verifies the
finished AppImage. Publishing is disabled. Outputs are:

- `release/RPGraph-Studio-<version>-x86_64.AppImage`: the file to copy or distribute.
- `release/RPGraph-Studio-<version>-x86_64.AppImage.sha256`: its SHA-256 checksum.
- `release/linux-unpacked/`: intermediate Electron application files.

Older AppImages may remain in `release/`; use the filename matching the current
application version. The generated directory is ignored by Git.

Run `npm run package:linux:verify` to repeat verification without rebuilding.
It extracts the current version's AppImage into a temporary directory without
launching Electron. It checks executable permissions, desktop identity, package
metadata, the Electron runtime files, and bundled resources against the current
checkout. The application archive must contain exactly the renderer, main/preload
modules, shared modules, format schemas, icons, and ComfyUI templates; unit tests,
unbundled dependencies, and updater metadata are rejected. It checks the runtime's
ELF headers to reject a system dynamic loader or host shared-library dependencies,
including a regression to the legacy FUSE 2 runtime. Temporary files are removed.
Any earlier checksum is deleted first, and a new one is written only after
verification passes. This checks package contents; manually test startup and
application behavior separately. Build release files from a clean checkout of
the commit being published, because verification compares against the checkout.

## Run on a Linux desktop

Download the AppImage for an Intel/AMD x86_64 Linux desktop, open its file
properties, allow execution as a program, and launch it from the file manager.
The exact labels depend on the desktop and file manager. No application installer
or administrator password is needed. From a terminal, the equivalent is:

```bash
chmod +x /path/to/RPGraph-Studio-<version>-x86_64.AppImage
/path/to/RPGraph-Studio-<version>-x86_64.AppImage
```

Replace `<version>` and `/path/to/` with the actual filename and location. Run as
your normal desktop user. To verify a copied download, keep its checksum beside it:

```bash
cd /path/to
sha256sum -c RPGraph-Studio-<version>-x86_64.AppImage.sha256
```

The application still needs a compatible glibc-based Linux desktop with the
usual graphics libraries. Normal AppImage mounting needs kernel FUSE access and
a working `fusermount` or `fusermount3` helper. A separate FUSE 2 library is not
required. Minimal installations and restricted containers can lack mounting
support; the static runtime does not automatically remove those restrictions.

Chromium's sandbox needs unprivileged user namespaces. The AppImage launcher
probes for them and starts the application with `--no-sandbox` when they are
unavailable, for example on distributions that restrict them through AppArmor.
The application then runs without the Chromium sandbox instead of failing to start.

If mounting is unavailable, use the built-in temporary extraction mode:

```bash
/path/to/RPGraph-Studio-<version>-x86_64.AppImage --appimage-extract-and-run
```

This starts the application without mounting, then cleans up the extracted
files when it exits. It takes additional disk space and may start more slowly.
See the [AppImage extraction documentation](https://docs.appimage.org/user-guide/troubleshooting/fuse.html#extract-and-run-type-2-appimages).
For repeated use without mounting, extract once and start its launcher:

```bash
mkdir -p ~/Applications/rpgraph-extracted
cd ~/Applications/rpgraph-extracted
/path/to/RPGraph-Studio-<version>-x86_64.AppImage --appimage-extract
./squashfs-root/AppRun
```

The AppImage does not automatically install an application-menu entry. See
[electron-builder's AppImage documentation](https://www.electron.build/v26/docs/appimage/)
for desktop integration. The repository starter's desktop entry launches the
source checkout, so use the AppImage directly when testing the package.

## Manual package validation

Copy the AppImage outside the repository and start it from a terminal to capture
any startup errors. Test on your actual desktop session (Wayland or X11):

1. Open the application and confirm that the interface and icons load offline.
2. Create or sign in to a local account. Existing source-build data uses the same
   `RPgraph Studio` user-data directory; use a test account for package checks.
3. Check that bundled default workflows, the standalone Storybook, and NPC
   characters are available. Default imports follow the application's existing
   import rules and do not overwrite local edits.
4. Save and reopen an RP/workflow, import and export a file, close the app, and
   reopen it to check persistence.
5. Exercise the providers you use and confirm their settings still work.

Application data stays in the existing user-data directory, normally
`~/.config/RPgraph Studio` (or under `XDG_CONFIG_HOME`), independently of where
the AppImage lives. AI providers and ComfyUI remain external services.
The application contains no face detector: avatar faces are marked by hand, or
estimated by the vision provider selected in the Character Assistant.

An Arch Linux build and manual test do not establish compatibility with every
Linux distribution. Test additional target distributions before publishing a
general Linux release, including one that restricts unprivileged user namespaces
and one without a `fusermount` helper. See the
[Windows installer guide](windows-installer.md) for the Windows package.

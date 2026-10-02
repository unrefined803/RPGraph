# Windows installer

RPGraph Studio uses a full **NSIS EXE installer** for direct downloads. One file
contains both native x64 (Intel/AMD) and ARM64 applications; the installer selects
the appropriate payload. The bundled Electron version supports Windows 10 and
newer. Windows 7/8 and 32-bit Windows are not supported; the installer shows a
message and exits on those systems instead of installing an unusable application.

## Install and update

Download `RPGraph-Studio-<version>-Windows-Setup.exe` and open it. The installer
defaults to installation for the current user, offers a destination folder, and
creates Start menu and desktop shortcuts plus a Windows uninstall entry. The
optional installation for all users requires administrator approval. RPGraph
itself runs with normal user permissions.

The complete application, Electron, default content, NPC characters, and ComfyUI
templates are included. Installing does not require Node.js, npm, Wine, or a
separate Electron runtime. Installation works offline after downloading the
installer. AI providers and ComfyUI remain external services. Optional automatic
face detection needs a separate Python environment and model; manual portrait
cropping does not.

To update, close RPGraph and run the new version's installer with the same
installation scope. The standard electron-builder NSIS upgrade replaces the old
program and preserves application data. Keep `appId`, executable name, product
name, and installation conventions stable in future releases. Increase the
application version for each published update. Automatic update checks inside
the application are not implemented by this packaging change.

Program files and user data are separate:

- Current-user installation normally lives under `%LOCALAPPDATA%\Programs`.
- All-user installation normally lives under `%ProgramFiles%`.
- Settings, accounts, and saved content live under `%APPDATA%\RPgraph Studio`.
- Explicit exports can live outside those directories.

The uninstaller offers an **Accounts, settings and saved content** checkbox,
which is unchecked by default. Leave it unchecked to preserve local data for a
reinstallation. Select it to permanently remove the displayed
`%APPDATA%\RPgraph Studio` folder, including all local RPGraph accounts and their
saved content. This also removes data shared with source checkouts. Files exported
elsewhere are not removed.

The option applies only to the Windows user running the uninstaller, including
for an all-user installation. If you run it using another administrator's
credentials, it applies to that administrator's profile; check the displayed
folder. Other Windows users' data must be removed from their respective profiles.
Updates skip this selection and preserve data. Unattended uninstalls do not
select the optional component. Source checkouts can also use the repository
starter's separate reset option.

To check a download against its checksum file, compare the value printed by
PowerShell with the one in `RPGraph-Studio-<version>-Windows-Setup.exe.sha256`:

```powershell
(Get-FileHash .\RPGraph-Studio-<version>-Windows-Setup.exe -Algorithm SHA256).Hash.ToLower()
```

Without configured signing credentials, builds are unsigned. Windows may show
an unknown-publisher or SmartScreen warning. A trusted code-signing certificate
is a separate release setup step; this repository does not bundle signing keys
or bypass Windows security checks. See [Windows code signing](https://www.electron.build/v26/docs/code-signing-win/).

## Build on Windows

Install Node.js 24 or newer. From the repository root:

```powershell
npm ci
npm run package:windows
```

Alternatively, open `RPGraph-windows.bat` and choose **8) Build Windows installer**.
The first build downloads the Windows Electron distributions and packaging
tools. No separate NSIS installation is required.

## Build on Linux

Use an x86_64 Linux build host with Node.js 24 or newer and working Wine. On Arch:

```bash
sudo pacman -S --needed wine
npm ci
npm run package:windows
```

The Linux starter offers **9) Build Windows installer**. Wine is required only
on the build host to generate the NSIS uninstaller. The build checks for Wine
before compiling or downloading Windows payloads. No Electron window is launched
during packaging. Wine uses an isolated build prefix at
`node_modules/.cache/rpgraph-wine`; the user's normal Wine prefix is not used.
Initialization runs without a display and disables optional Mono/Gecko downloads.

Use system Wine: the downloadable Wine 1.0.1 toolset provided by the current
electron-builder dependencies lacks its Windows builtin DLLs and cannot complete
the build by itself. Do not pin `toolsets.wine` to that bundle.

## Outputs and verification

The command builds both architectures, creates one installer, extracts its actual
embedded application archives without running the installer, verifies both PE
architectures, the uninstaller, the Electron runtime files, and all application
content against the checkout, and writes a SHA-256 checksum. Any earlier checksum
is deleted first. Publishing is disabled and no updater metadata is generated.
Build release files from a clean checkout of the commit being published, because
verification compares against the checkout.

- `release/RPGraph-Studio-<version>-Windows-Setup.exe`: the single user download.
- `release/RPGraph-Studio-<version>-Windows-Setup.exe.sha256`: download checksum.
- `release/win-unpacked/` and `release/win-arm64-unpacked/`: intermediate files.
- `release/RPGraph-Studio-<version>-Windows-Setup.exe.blockmap`: an electron-builder
  by-product that the application does not use; do not upload it.

Run `npm run package:windows:verify` to repeat the content checks without building
or executing Windows code. Keep the intermediate unpacked directories local;
users only need the installer. For a manual GitHub release, upload the installer
and checksum alongside the Linux AppImage and its checksum. Do not publish the
temporary per-architecture archives or uninstaller build artifacts.

## Manual Windows validation before publishing

Cross-building and inspecting the payload do not test Windows installation or
application behavior. On a clean Windows desktop:

1. Install as a normal user without Node.js; confirm shortcuts and the uninstall entry.
   Expect an unknown-publisher or SmartScreen warning while builds are unsigned.
2. Start the installed app and check bundled content, file dialogs, save/load,
   account sign-in, and the providers you use.
3. Close and restart to verify persistence.
4. Install a later application version over the first one using the same scope;
   confirm that accounts, settings, and saved content survive and only one app
   installation remains.
5. Uninstall with the data checkbox unchecked and reinstall; confirm user data
   remains available. Repeat with disposable data and the checkbox checked;
   confirm the displayed data folder is removed and exported files remain.
6. Test the optional all-user installation and an ARM64 Windows machine separately
   when those configurations are available. Check the displayed data path when
   elevation uses a different administrator account; other profiles must remain
   untouched. Confirm updates never show or execute the optional data removal.
7. When a 32-bit or pre-Windows 10 system is available, confirm that the installer
   exits with its requirement message.

Installer behavior uses the maintained [electron-builder NSIS templates](https://www.electron.build/v26/docs/nsis/).

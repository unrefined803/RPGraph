; Refuse systems the bundled Electron runtime cannot run on. The combined
; installer carries only x64 and ARM64 payloads, so the standard templates do
; not stop 32-bit Windows or Windows versions older than Windows 10.
!macro preInit
  !ifndef BUILD_UNINSTALLER
    ${IfNot} ${AtLeastWin10}
      MessageBox MB_OK|MB_ICONEXCLAMATION "${PRODUCT_NAME} requires Windows 10 or newer." /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
    ${IfNot} ${RunningX64}
    ${AndIfNot} ${IsNativeARM64}
      MessageBox MB_OK|MB_ICONEXCLAMATION "${PRODUCT_NAME} requires 64-bit Windows (x64 or ARM64)." /SD IDOK
      SetErrorLevel 1
      Quit
    ${EndIf}
  !endif
!macroend

; electron-builder adds the uninstaller components page when this section hook
; exists. Use it as the first page instead of a redundant welcome page.
!define removeDefaultUninstallWelcomePage

!ifdef BUILD_UNINSTALLER
  !include LogicLib.nsh
  !define MUI_PAGE_CUSTOMFUNCTION_PRE un.RPGraphComponentsPre
  !define MUI_COMPONENTSPAGE_TEXT_TOP "Program files are always removed. Optionally delete this Windows user's local accounts, settings and saved content permanently. Exported files and other Windows users' data are kept."
  !define MUI_COMPONENTSPAGE_TEXT_COMPLIST "Local data folder: $rpgraphUserDataDirectory"
  Var rpgraphUserDataDirectory

!endif

; Emit functions after electron-builder has registered its NSIS plugins.
!macro customHeader
  !ifdef BUILD_UNINSTALLER
    Function un.RPGraphComponentsPre
      ${If} ${isUpdated}
        Abort
      ${EndIf}
    FunctionEnd
  !endif
!macroend

!macro customUnInit
  ; Resolve the same roaming AppData location as Electron, even for an all-user
  ; installation. Never enumerate or delete other Windows users' profiles.
  SetShellVarContext current
  StrCpy $rpgraphUserDataDirectory "$APPDATA\RPgraph Studio"
  ${If} $installMode == "all"
    SetShellVarContext all
  ${EndIf}
!macroend

!macro customUnInstallSection
  ; /o makes this checkbox unchecked on every new uninstaller invocation.
  Section /o "un.Accounts, settings and saved content"
    ; Updates and unattended uninstalls must never opt into this UI choice.
    ${IfNot} ${isUpdated}
    ${AndIfNot} ${Silent}
      ClearErrors
      RMDir /r "$rpgraphUserDataDirectory"
      ${If} ${Errors}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Some local data could not be removed. Close applications using this folder and remove it manually:$\r$\n$rpgraphUserDataDirectory"
        SetErrorLevel 1
      ${EndIf}
    ${EndIf}
  SectionEnd
!macroend

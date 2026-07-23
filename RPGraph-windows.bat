@echo off
setlocal EnableExtensions

cd /d "%~dp0"

set "ELECTRON_RUN_AS_NODE="

where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js with npm was not found.
  echo Install Node.js LTS for Windows, then start this file again.
  echo.
  pause
  exit /b 1
)

:menu
cls
echo ======================================
echo  RPgraph Studio - Windows Starter
echo ======================================
echo.
echo 1^) Start app ^(Normal / Offline^)
echo 2^) Start app ^(Development / Live Reload^)
echo 3^) Build production app only
echo 4^) Install dependencies
echo 5^) Reset generated files
echo 6^) Reset local app data ^(delete RPGraph saves/settings^)
echo 7^) Exit
echo.
set /p "choice=Selection: "

if "%choice%"=="1" goto start_normal
if "%choice%"=="2" goto start_dev
if "%choice%"=="3" goto build_app
if "%choice%"=="4" goto install_dependencies
if "%choice%"=="5" goto reset_generated_files
if "%choice%"=="6" goto reset_local_app_data
if "%choice%"=="7" exit /b 0

echo.
echo Invalid selection.
goto pause_and_menu

:ensure_dependencies
rem The lockfile snapshot lets us detect when package-lock.json changed since
rem the last install (e.g. after a git pull), not just whether node_modules exists.
if exist "node_modules\" (
  fc /b "package-lock.json" "node_modules\.rpgraph-package-lock.json" >nul 2>&1
  if not errorlevel 1 exit /b 0
)

echo.
choice /C YN /N /M "Dependencies are missing or outdated. Install them now with npm ci? [Y/N] "
if errorlevel 2 (
  echo.
  echo Start canceled: please run option 4 first.
  exit /b 1
)

echo.
call :run_clean_install
exit /b %errorlevel%

:run_clean_install
call npm ci
if not errorlevel 1 goto run_clean_install_ok
echo.
echo npm ci could not install from the lock file.
echo package.json and package-lock.json may be out of sync. Recovering with npm install ...
echo.
call npm install
if errorlevel 1 exit /b %errorlevel%
:run_clean_install_ok
copy /y "package-lock.json" "node_modules\.rpgraph-package-lock.json" >nul
exit /b 0

:start_normal
call :ensure_dependencies
if errorlevel 1 goto pause_and_menu
echo.
echo Building the local app and starting RPgraph Studio ...
call npm run build
if errorlevel 1 goto pause_and_menu
set "ELECTRON_RUN_AS_NODE="
"%~dp0node_modules\electron\dist\electron.exe" .
goto pause_and_menu

:start_dev
call :ensure_dependencies
if errorlevel 1 goto pause_and_menu
echo.
echo Starting RPgraph Studio in development mode with a localhost server ...
call npm run desktop:windows:dev
goto pause_and_menu

:build_app
call :ensure_dependencies
if errorlevel 1 goto pause_and_menu
echo.
echo Building the production app ...
call npm run build
goto pause_and_menu

:install_dependencies
echo.
echo Installing dependencies exactly as pinned in package-lock.json ...
call :run_clean_install
goto pause_and_menu

:reset_generated_files
echo.
echo Reset removes generated files only:
echo   - dist ^(build output^)
echo   - node_modules ^(installed packages, optional^)
echo Source code and Git history remain untouched.
echo.
choice /C YN /N /M "Remove the dist build output? [Y/N] "
if errorlevel 2 goto ask_remove_modules
if exist "dist\" rmdir /s /q "dist"
echo dist has been removed.

:ask_remove_modules
choice /C YN /N /M "Remove node_modules too? npm ci will be required afterward. [Y/N] "
if errorlevel 2 goto pause_and_menu
if exist "node_modules\" rmdir /s /q "node_modules"
echo node_modules has been removed.
goto pause_and_menu

:reset_local_app_data
set "RPGRAPH_USER_DATA=%APPDATA%\RPgraph Studio"
echo.
echo This deletes the local RPGraph app data folder:
echo   "%RPGRAPH_USER_DATA%"
echo.
echo This includes locally stored workflows, RP saves, storybooks, settings,
echo window state, and cached browser data for RPGraph Studio.
echo.
echo Close RPGraph Studio before continuing.
echo.
choice /C YN /N /M "Delete local app data now? [Y/N] "
if errorlevel 2 goto pause_and_menu
if exist "%RPGRAPH_USER_DATA%\" (
  rmdir /s /q "%RPGRAPH_USER_DATA%"
  echo Local app data has been removed.
) else (
  echo Local app data folder was not found.
)
goto pause_and_menu

:pause_and_menu
echo.
pause
goto menu

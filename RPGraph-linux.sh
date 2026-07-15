#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR" || exit 1

unset ELECTRON_RUN_AS_NODE

install_desktop_launcher() {
  local desktop_target_dir="$HOME/.local/share/applications"
  local desktop_target="$desktop_target_dir/rpgraph-studio.desktop"
  local launcher_target="$SCRIPT_DIR/RPGraph-linux-launch.sh"

  if [[ ! -f "$SCRIPT_DIR/src/assets/app-icons/rpgraph-512.png" || ! -f "$launcher_target" ]]; then
    return 0
  fi

  mkdir -p "$desktop_target_dir"
  for icon_size in 16 24 32 48 64 128 256 512 1024; do
    local icon_source="$SCRIPT_DIR/src/assets/app-icons/rpgraph-${icon_size}.png"
    local icon_target_dir="$HOME/.local/share/icons/hicolor/${icon_size}x${icon_size}/apps"
    if [[ -f "$icon_source" ]]; then
      mkdir -p "$icon_target_dir"
      cp "$icon_source" "$icon_target_dir/rpgraph-studio.png"
    fi
  done
  chmod +x "$launcher_target"

  cat > "$desktop_target" <<EOF
[Desktop Entry]
Type=Application
Name=RP Graph Studio
Comment=Local-first node graph studio for roleplay workflows
Exec=$launcher_target
Icon=rpgraph-studio
Terminal=false
Categories=Utility;
EOF

  update-desktop-database "$desktop_target_dir" >/dev/null 2>&1 || true
  gtk-update-icon-cache "$HOME/.local/share/icons/hicolor" >/dev/null 2>&1 || true
}

pause() {
  printf "\nPress Enter to return to the menu ..."
  read -r _
}

# The lockfile snapshot lets us detect when package-lock.json changed since
# the last install (e.g. after a git pull), not just whether node_modules exists.
lockfile_snapshot="node_modules/.rpgraph-package-lock.json"

run_clean_install() {
  if ! npm ci; then
    printf "\nnpm ci could not install from the lock file.\n"
    printf "package.json and package-lock.json may be out of sync. Recovering with npm install ...\n\n"
    npm install || return $?
  fi
  cp package-lock.json "$lockfile_snapshot"
}

ensure_dependencies() {
  if [[ -d node_modules ]] && cmp -s package-lock.json "$lockfile_snapshot"; then
    return 0
  fi

  printf "\nDependencies are missing or outdated. Install them now with npm ci? [y/N] "
  read -r answer

  if [[ "$answer" =~ ^[Yy]$ ]]; then
    run_clean_install
    return $?
  fi

  printf "\nStart canceled: please run option 4 first.\n"
  return 1
}

start_normal() {
  ensure_dependencies || return
  install_desktop_launcher
  printf "\nBuilding the local app and starting RPgraph Studio ...\n"
  npm run build && npm run desktop
}

start_dev() {
  ensure_dependencies || return
  install_desktop_launcher
  printf "\nStarting RPgraph Studio in development mode with a localhost server ...\n"
  npm run desktop:dev
}

build_app() {
  ensure_dependencies || return
  install_desktop_launcher
  printf "\nBuilding the production app ...\n"
  npm run build
}

install_dependencies() {
  printf "\nInstalling dependencies exactly as pinned in package-lock.json ...\n"
  run_clean_install
}

reset_generated_files() {
  printf "\nReset removes generated files only:\n"
  printf "  - dist (build output)\n"
  printf "  - node_modules (installed packages, optional)\n"
  printf "Source code and Git history remain untouched.\n\n"
  printf "Remove the dist build output? [y/N] "
  read -r remove_dist

  if [[ "$remove_dist" =~ ^[Yy]$ ]]; then
    rm -rf -- dist
    printf "dist has been removed.\n"
  fi

  printf "Remove node_modules too? npm ci will be required afterward. [y/N] "
  read -r remove_modules

  if [[ "$remove_modules" =~ ^[Yy]$ ]]; then
    rm -rf -- node_modules
    printf "node_modules has been removed.\n"
  fi
}

reset_local_app_data() {
  local config_home="${XDG_CONFIG_HOME:-$HOME/.config}"
  local user_data="$config_home/RPgraph Studio"

  printf "\nThis deletes the local RPGraph app data folder:\n"
  printf "  %s\n\n" "$user_data"
  printf "This includes locally stored workflows, RP saves, storybooks, settings,\n"
  printf "window state, and cached browser data for RPGraph Studio.\n\n"
  printf "Close RPGraph Studio before continuing.\n\n"
  printf "Delete local app data now? [y/N] "
  read -r answer

  if [[ "$answer" =~ ^[Yy]$ ]]; then
    if [[ -e "$user_data" ]]; then
      rm -rf -- "$user_data"
      printf "Local app data has been removed.\n"
    else
      printf "Local app data folder was not found.\n"
    fi
  fi
}

while true; do
  clear
  printf "======================================\n"
  printf " RPgraph Studio - Linux Starter\n"
  printf "======================================\n\n"
  printf "1) Start app (Normal / Offline)\n"
  printf "2) Start app (Development / Live Reload)\n"
  printf "3) Build production app only\n"
  printf "4) Install dependencies\n"
  printf "5) Reset generated files\n"
  printf "6) Reset local app data (delete RPGraph saves/settings)\n"
  printf "7) Exit\n\n"
  printf "Selection: "
  read -r choice

  case "$choice" in
    1)
      start_normal
      pause
      ;;
    2)
      start_dev
      pause
      ;;
    3)
      build_app
      pause
      ;;
    4)
      install_dependencies
      pause
      ;;
    5)
      reset_generated_files
      pause
      ;;
    6)
      reset_local_app_data
      pause
      ;;
    7)
      exit 0
      ;;
    *)
      printf "\nInvalid selection.\n"
      pause
      ;;
  esac
done

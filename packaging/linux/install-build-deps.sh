#!/usr/bin/env bash
# The system libraries OpenNote links on Linux, for CI and for anyone building from source on Debian or Ubuntu.
# WebKitGTK 4.1 is Tauri 2's web view. librsvg draws the icons, libayatana-appindicator is the tray icon, libxdo is
# the menu accelerators, and ALSA is the microphone. CMake and libclang build libopus and SQLite.
set -euo pipefail
sudo apt-get update -q
sudo apt-get install -y -q --no-install-recommends \
  build-essential cmake clang libclang-dev pkg-config file patchelf \
  libwebkit2gtk-4.1-dev libgtk-3-dev libsoup-3.0-dev libjavascriptcoregtk-4.1-dev \
  libayatana-appindicator3-dev librsvg2-dev libssl-dev libxdo-dev libasound2-dev

#!/bin/bash
# Double-click on macOS (or run ./start.command on Linux) to install, build and open GUG-cli.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "GUG-cli needs Node.js 20 or newer: https://nodejs.org"
  (command -v open >/dev/null && open https://nodejs.org) || true
  exit 1
fi
[ -d node_modules ] || { echo "First run: installing GUG-cli…"; npm install || exit 1; }
[ -f web/dist/index.html ] && [ -f dist/cli.js ] || { echo "Building the app…"; npm run build || exit 1; }
exec node bin/gug.mjs serve "$@"

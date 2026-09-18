#!/bin/sh
set -eu
APP_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_BIN=$(command -v node)
NODE_REAL=$(node -p 'require("fs").realpathSync(process.execPath)')
ENGINE="$APP_ROOT/rust/engine-host/target/release/style-engine-host"
cd "$APP_ROOT"
mkdir -p var
chmod 700 var
exec /usr/bin/sandbox-exec -D "APP_ROOT=$APP_ROOT" -D "NODE=$NODE_REAL" -D "ENGINE=$ENGINE" -f "$APP_ROOT/deploy/macos.sb" "$NODE_REAL" src/server/index.js

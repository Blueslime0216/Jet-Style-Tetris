#!/usr/bin/env bash
set -euo pipefail
export GIT_LFS_SKIP_SMUDGE=1
if [ ! -f vendor/tetr_online/crates/tetr-core/Cargo.toml ]; then
  git -c filter.lfs.required=false -c filter.lfs.smudge=cat -c filter.lfs.process= submodule update --init --depth 1 vendor/tetr_online
fi
if [ ! -x "$HOME/.cargo/bin/rustup" ]; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs -o /tmp/style-rustup.sh
  sh /tmp/style-rustup.sh -y --profile minimal --default-toolchain 1.98.1 --no-modify-path
else
  "$HOME/.cargo/bin/rustup" toolchain install 1.98.1 --profile minimal
fi
RUSTUP_TOOLCHAIN=1.98.1 npm run build:engine

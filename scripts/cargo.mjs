import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
const local = `${homedir()}/.cargo/bin/cargo`;
const [command, ...args] = process.argv.slice(2);
const result = spawnSync(
  existsSync(local) ? local : "cargo",
  [
    command,
    "--manifest-path",
    "rust/engine-host/Cargo.toml",
    "--locked",
    ...args,
  ],
  { stdio: "inherit" },
);
if (result.error)
  console.error("Rust toolchain unavailable. Install rustup and retry.");
process.exit(result.status ?? 1);

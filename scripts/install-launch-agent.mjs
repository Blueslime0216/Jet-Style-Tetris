import { mkdir, writeFile, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const label = "local.style-agent.demo";
const dir = `${homedir()}/Library/LaunchAgents`;
const target = `${dir}/${label}.plist`;
const esc = (s) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
await mkdir(dir, { recursive: true });
await mkdir(`${root}/var`, { recursive: true, mode: 0o700 });
const args = [
  "/usr/bin/sandbox-exec",
  "-D",
  `APP_ROOT=${root}`,
  "-D",
  `NODE=${realpathSync(process.execPath)}`,
  "-D",
  `ENGINE=${root}/rust/engine-host/target/release/style-engine-host`,
  "-f",
  `${root}/deploy/macos.sb`,
  realpathSync(process.execPath),
  "src/server/index.js",
];
const xml = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((a) => `<string>${esc(a)}</string>`).join("")}</array><key>WorkingDirectory</key><string>${esc(root)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict><key>ThrottleInterval</key><integer>10</integer><key>EnvironmentVariables</key><dict><key>NODE_ENV</key><string>production</string><key>HOST</key><string>127.0.0.1</string></dict><key>StandardOutPath</key><string>${esc(root)}/var/server.log</string><key>StandardErrorPath</key><string>${esc(root)}/var/server-error.log</string></dict></plist>`;
try {
  const old = await readFile(target, "utf8");
  if (!old.includes(root))
    throw new Error("Existing launch agent belongs to another project");
  try {
    execFileSync("launchctl", ["bootout", `gui/${process.getuid()}/${label}`], {
      stdio: "ignore",
    });
  } catch {}
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
await writeFile(target, xml, { mode: 0o600 });
execFileSync("plutil", ["-lint", target], { stdio: "inherit" });
// launchd can still be unloading the previous job after bootout returns.
for (let attempt = 0; ; attempt++) {
  try {
    execFileSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, target], {stdio: "pipe"});
    break;
  } catch (error) {
    if (attempt >= 5) throw error;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}
console.log(`Installed ${label}. Local listener only; user-login service.`);

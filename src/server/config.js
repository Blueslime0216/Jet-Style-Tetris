import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
export function config() {
  let file = {};
  try {
    file = parseEnv(
      readFileSync(new URL("../../.env", import.meta.url), "utf8"),
    );
  } catch {}
  return { ...file, ...process.env };
}

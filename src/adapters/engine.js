import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
const binary = fileURLToPath(
  new URL(
    "../../rust/engine-host/target/release/style-engine-host",
    import.meta.url,
  ),
);
export class EngineHost {
  constructor() {
    this.pending = [];
    this.closed = false;
    this.child = spawn(binary, [], {
      stdio: ["pipe", "pipe", "pipe"],
      env: {},
    });
    this.child.stdin.on("error", () => this.fail());
    this.error = "";
    this.child.stderr.on("data", (d) => {
      this.error = (this.error + d.toString()).slice(-1000);
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const item = this.pending.shift();
      if (!item) return;
      clearTimeout(item.timer);
      try {
        const r = JSON.parse(line);
        r.ok ? item.resolve(r.data) : item.reject(new Error(r.error));
      } catch (e) {
        item.reject(e);
      }
    });
    this.child.on("error", () => this.fail());
    this.child.on("exit", () => this.fail());
  }
  fail() {
    this.closed = true;
    for (const p of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error("Game engine unavailable"));
    }
    this.pending = [];
  }
  send(command) {
    if (this.closed) return Promise.reject(new Error("Engine closed"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.close();
        reject(new Error("Engine timeout"));
      }, 5000);
      this.pending.push({ resolve, reject, timer });
      this.child.stdin.write(JSON.stringify(command) + "\n");
    });
  }
  close() {
    this.child.kill();
    this.fail();
  }
}

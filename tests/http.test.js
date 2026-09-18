import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";

test(
  "HTTP accepts proxy-sized browser headers and rejects excessive headers",
  { timeout: 10000 },
  async () => {
    const listener = createServer();
    listener.listen(0, "127.0.0.1");
    await once(listener, "listening");
    const port = listener.address().port;
    await new Promise((r) => listener.close(r));
    const child = spawn(process.execPath, ["src/server/index.js"], {
      env: {
        ...process.env,
        PORT: String(port),
        HOST: "127.0.0.1",
        PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
        VERCEL: "",
        JEV_API_KEY: "",
        GEMINI_API_KEY: "",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await Promise.race([
        once(child.stdout, "data"),
        once(child, "exit").then(() => {
          throw new Error("HTTP test server exited");
        }),
      ]);
      const base = `http://127.0.0.1:${port}`;
      const normal = await fetch(base + "/health", {
        headers: { Cookie: "proxy-test=" + "x".repeat(20000) },
      });
      assert.equal(normal.status, 200);
      assert.deepEqual(await normal.json(), { ok: true });
      const oversized = await fetch(base + "/health", {
        headers: { Cookie: "proxy-test=" + "x".repeat(80000) },
      });
      assert.equal(oversized.status, 431);
    } finally {
      child.kill("SIGTERM");
      await once(child, "exit");
    }
  },
);

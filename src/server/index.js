import http from "node:http";
import { readFile, stat } from "node:fs/promises";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve, extname, sep } from "node:path";
import { WebSocketServer } from "ws";
import { config } from "./config.js";
import { PRESETS, validateStyle } from "../core/style.js";
import { Budget, JevAdapter, GeminiAdapter } from "../adapters/providers.js";
import { Match } from "./match.js";
import { Sessions } from "./session.js";
import { sharedQuota } from "./shared-quota.js";
const cfg = config(),
  port = Number(cfg.PORT || 3000),
  host = cfg.HOST || "127.0.0.1";
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid PORT");
const deployed = cfg.VERCEL === "1";
if (deployed && (!cfg.SESSION_SECRET || cfg.SESSION_SECRET.length < 32))
  throw new Error(
    "Set SESSION_SECRET to a random secret of at least 32 characters.",
  );
const publicOrigin =
  cfg.PUBLIC_ORIGIN ||
  (deployed
    ? `https://${cfg.VERCEL_PROJECT_PRODUCTION_URL || cfg.VERCEL_URL}`
    : `http://localhost:${port}`);
const origins = new Set([
  publicOrigin,
  ...(deployed
    ? [
        cfg.VERCEL_URL && `https://${cfg.VERCEL_URL}`,
        cfg.VERCEL_BRANCH_URL && `https://${cfg.VERCEL_BRANCH_URL}`,
      ].filter(Boolean)
    : [`http://localhost:${port}`, `http://127.0.0.1:${port}`]),
]);
const hosts = new Set([...origins].map((x) => new URL(x).host));
const root = resolve(fileURLToPath(new URL("../../web/", import.meta.url)));
const branding = JSON.parse(
  await readFile(
    new URL("../../config/branding.json", import.meta.url),
    "utf8",
  ),
);
const sessionStore = new Sessions(cfg.SESSION_SECRET || undefined),
  sessions = sessionStore.rows,
  limits = new Map(),
  sockets = new Set();
let activeMatches = 0;
const budget = new Budget({
  limit: Math.min(
    10000,
    Math.max(10, Number(cfg.DAILY_API_CALL_LIMIT) || 2000),
  ),
  persist: !deployed,
  reserve: deployed ? sharedQuota(cfg) : null,
});
const provider = new JevAdapter({ budget }),
  compiler = new GeminiAdapter({ budget });
const header = {
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cache-Control": "no-store",
};
function rate(key, cap, period = 60000) {
  const now = Date.now();
  let row = limits.get(key);
  if (!row || row.until < now) {
    row = { count: 0, until: now + period };
    limits.set(key, row);
  }
  return ++row.count <= cap;
}
function send(res, code, data, extra = {}) {
  res.writeHead(code, {
    ...header,
    "Content-Type": "application/json; charset=utf-8",
    ...extra,
  });
  res.end(JSON.stringify(data));
}
function session(req) {
  return sessionStore.read(
    req.headers.cookie?.match(/(?:^|; )session=([^;]+)(?:;|$)/)?.[1],
  );
}
async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16384) throw new Error("body_limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks));
}
function sameOrigin(req) {
  return origins.has(req.headers.origin);
}
function csrf(req, s) {
  const token = req.headers["x-csrf-token"];
  return (
    typeof token === "string" &&
    token.length === s.csrf.length &&
    timingSafeEqual(Buffer.from(token), Buffer.from(s.csrf))
  );
}
const server = http.createServer(async (req, res) => {
  const ip = req.socket.remoteAddress ?? "unknown";
  try {
    if (!hosts.has(req.headers.host) || !rate(ip + ":http", 600)) {
      send(res, 429, { error: "요청을 잠시 쉬어 주세요." });
      return;
    }
    const url = new URL(req.url, publicOrigin);
    if (req.method === "GET" && url.pathname === "/health") {
      send(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/bootstrap") {
      let s = session(req);
      if (!s) {
        if (sessions.size >= 200) {
          send(res, 503, { error: "서버가 혼잡합니다." });
          return;
        }
        s = sessionStore.issue();
      }
      const current = config();
      send(
        res,
        200,
        {
          branding,
          presets: PRESETS,
          csrf: s.csrf,
          providers: {
            jev: !!current.JEV_API_KEY,
            gemini: !!current.GEMINI_API_KEY,
          },
          limits: { maxSeconds: 240 },
          notices: ["기본 룰: Guideline, All-Spin 미지원"],
        },
        {
          "Set-Cookie": `session=${s.token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=1800${publicOrigin.startsWith("https:") ? "; Secure" : ""}`,
        },
      );
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/style") {
      const s = session(req);
      if (!s || !sameOrigin(req) || !csrf(req, s)) {
        send(res, 403, { error: "세션을 새로고침해 주세요." });
        return;
      }
      if (!rate(s.id + ":style", 5) || !rate(ip + ":style", 15)) {
        send(res, 429, { error: "스타일 변환은 잠시 후 다시 시도해 주세요." });
        return;
      }
      const data = await body(req);
      if (Object.keys(data).some((k) => k !== "text")) {
        send(res, 400, { error: "잘못된 요청입니다." });
        return;
      }
      try {
        const profile = await compiler.compile(data.text);
        send(res, 200, { profile, source: "gemini" });
      } catch (e) {
        send(res, e.code === "invalid_input" ? 400 : 503, {
          error:
            e.code === "key_missing"
              ? "Gemini 연결이 준비되지 않았습니다. 프리셋을 선택해 주세요."
              : "스타일 변환에 실패했습니다. 기존 스타일을 유지합니다. 반복되면 프리셋을 사용해 주세요.",
          code: e.code ?? "compile_failed",
        });
      }
      return;
    }
    if (req.method !== "GET") {
      send(res, 405, { error: "Method not allowed" });
      return;
    }
    const path = decodeURIComponent(url.pathname);
    if (path.includes("\0") || path.split("/").some((p) => p.startsWith("."))) {
      send(res, 404, { error: "Not found" });
      return;
    }
    const file = resolve(root, "." + (path === "/" ? "/index.html" : path));
    if (!file.startsWith(root + sep)) {
      send(res, 404, { error: "Not found" });
      return;
    }
    const mime = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".svg": "image/svg+xml",
      ".woff2": "font/woff2",
    }[extname(file)];
    if (!mime || !(await stat(file)).isFile()) {
      send(res, 404, { error: "Not found" });
      return;
    }
    res.writeHead(200, { ...header, "Content-Type": mime });
    res.end(await readFile(file));
  } catch {
    if (!res.headersSent)
      send(res, 400, { error: "요청을 처리할 수 없습니다." });
    else res.end();
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.maxHeadersCount = 50;
const wss = new WebSocketServer({
  noServer: true,
  maxPayload: 16384,
  perMessageDeflate: false,
});
server.on("upgrade", (req, socket, head) => {
  const s = session(req);
  if (
    req.url !== "/play" ||
    !sameOrigin(req) ||
    !hosts.has(req.headers.host) ||
    !s ||
    s.ws ||
    !rate((req.socket.remoteAddress ?? "unknown") + ":ws", 15)
  ) {
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => {
    s.ws = ws;
    wss.emit("connection", ws, req, s);
  });
});
wss.on("connection", (ws, req, s) => {
  sockets.add(ws);
  let match = null,
    lastReplay = null;
  const emit = (data) => {
    if (ws.readyState === 1 && ws.bufferedAmount < 1_000_000)
      ws.send(JSON.stringify(data));
  };
  ws.on("message", async (raw) => {
    try {
      if (!rate(s.id + ":message", 240, 1000)) {
        ws.close(1008, "Rate limit");
        return;
      }
      const m = JSON.parse(raw.toString());
      switch (m.type) {
        case "start": {
          if (!rate(s.id + ":start", 6) || activeMatches >= 4) {
            emit({
              type: "error",
              message: "현재 경기 수가 많습니다. 잠시 후 시도해 주세요.",
            });
            break;
          }
          if (
            !["human", "bots"].includes(m.mode) ||
            !Number.isInteger(m.seed) ||
            m.seed < 0 ||
            m.seed > 4294967295 ||
            !Array.isArray(m.styles) ||
            m.styles.length !== 2
          )
            throw new Error("invalid");
          const styles = m.styles.map(validateStyle);
          match?.end("restarted");
          activeMatches++;
          match = new Match({
            seed: m.seed,
            mode: m.mode,
            styles,
            provider,
            onUpdate: emit,
            onEnd: (ended) => {
              activeMatches--;
              lastReplay = ended.replay();
            },
          });
          try {
            await match.start();
          } catch {
            match.end("engine_error");
            emit({
              type: "error",
              message: "게임 엔진을 시작하지 못했습니다.",
            });
          }
          break;
        }
        case "input":
          if (
            match &&
            !match.paused &&
            !match.stopped &&
            ["left", "right", "soft", "drop", "cw", "ccw", "hold"].includes(
              m.action,
            )
          )
            match.setInput(m.action);
          break;
        case "pause":
          if (match && !match.stopped) {
            match.paused = !match.paused;
            emit(match.message());
          }
          break;
        case "stop":
          match?.end();
          break;
        case "style":
          if (match && [0, 1].includes(m.seat))
            match.applyStyle(m.seat, validateStyle(m.style));
          break;
        case "replay":
          if (match && !match.stopped) match.end("saved");
          if (lastReplay?.finalState)
            emit({ type: "replay", data: lastReplay });
          break;
        default:
          throw new Error("invalid");
      }
    } catch {
      emit({ type: "error", message: "요청 형식을 확인해 주세요." });
    }
  });
  ws.on("close", () => {
    match?.end("disconnected");
    s.ws = null;
    sockets.delete(ws);
  });
  ws.on("error", () => ws.close());
});
// Bounded operator logs. Keys and user prompts are never written here.
const rotate = setInterval(async () => {
  for (const name of ["server.log", "server-error.log"]) {
    const path = new URL("../../var/" + name, import.meta.url);
    try {
      if ((await stat(path)).size > 1_000_000) {
        const { copyFile, truncate } = await import("node:fs/promises");
        await copyFile(
          path,
          new URL("../../var/" + name + ".1", import.meta.url),
        );
        await truncate(path, 0);
      }
    } catch {}
  }
}, 60000);
rotate.unref();
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions)
    if (s.expires < now) {
      s.ws?.close();
      sessions.delete(id);
    }
  for (const [k, v] of limits) if (v.until < now) limits.delete(k);
}, 60000);
cleanup.unref();
server.on("error", () => {
  console.error("Listener unavailable; check the configured local port.");
  process.exit(1);
});
if (!deployed)
  server.listen(port, host, () =>
    console.log(`Style demo ready at http://${host}:${port}`),
  );
export default server;
function shutdown() {
  for (const ws of sockets) ws.close();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

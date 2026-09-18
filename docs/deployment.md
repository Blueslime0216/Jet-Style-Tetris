# Deployment

## Vercel

Target: https://jet-style-tetris.vercel.app

1. Import `Blueslime0216/Jet-Style-Tetris` into Vercel. Use **Other** as the framework, keep the repository build command, and leave Output Directory unset.
2. Keep **Fluid Compute** enabled. `api/server.js` exports the Node HTTP/WebSocket server; `vercel.json` gives it a 300-second duration and bundles the native engine.
3. Set the following environment variables, then deploy:

| Variable                   | Purpose                                                                                         |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| `SESSION_SECRET`           | Required. A stable random secret, at least 32 characters. Generate with `openssl rand -hex 32`. |
| `JEV_API_KEY`              | Jev decisions; omit for fallback-only play.                                                     |
| `GEMINI_API_KEY`           | Natural-language style compilation.                                                             |
| `GEMINI_MODEL`             | Default: `gemini-3.8-flash`.                                                                    |
| `UPSTASH_REDIS_REST_URL`   | Shared request-budget store, from an Upstash Redis integration.                                 |
| `UPSTASH_REDIS_REST_TOKEN` | Redis REST token; keep server-side.                                                             |
| `DAILY_API_CALL_LIMIT`     | Default 2,000 combined provider requests per UTC day; maximum 10,000.                           |
| `PUBLIC_ORIGIN`            | Optional for a custom domain. The production Vercel hostname is detected automatically.         |

Never use a browser-exposed environment-variable prefix for these secrets. Redis is required for **paid provider calls** on Vercel. Without it, the server refuses upstream calls, labels decisions as fallback, and keeps preset gameplay available. Quota reservations are atomic across instances; connection-local limits are additional safeguards, not a global quota.

### Build and lifecycle

The build fetches the pinned public submodule if needed, installs the pinned Rust toolchain when unavailable, and builds the native host for the deployment machine. Node dependencies are installed from the lockfile. No macOS executable is committed.

Vercel [supports WebSockets in beta](https://vercel.com/docs/functions/websockets) with Fluid Compute. A connection stays on one instance, so a match and its native engine stay together. Signed sessions work even when bootstrap and WebSocket requests reach different instances. Matches are limited to four minutes; the enclosing WebSocket connection is also subject to the function's duration. A dropped connection ends the match. Refresh to reconnect; in-progress match recovery across instances is not implemented. Download replays before leaving.

The game writes no replay files in production. Quotas use Redis, sessions are signed, and match data lives for the WebSocket connection. The macOS sandbox and LaunchAgent do not run on Vercel.

### After the first deployment

- Open `/health`, then start both a human and a bot match.
- Confirm Inspector says **Jev** when keys and Redis are configured; verify an intentional provider failure is labeled **Fallback**.
- Compile a style and check that explicit prohibitions survive. A Gemini quota failure must preserve the previous profile.
- Download and reopen a replay. Check browser and Vercel logs for errors without logging secrets or full prompts.
- Use Vercel's project spending controls and upgrade-path firewall limits as an additional operational limit.

The repository's local tests and native build are verified. The first actual Vercel deployment must still validate the Linux bundle and WebSocket beta integration.

## Local Mac mini

`npm start` binds to `127.0.0.1:3123` by default. API keys belong in `.env` (mode 600), which is ignored by Git. Provider settings are reread for requests; server origin/port settings require a restart.

```bash
npm run install:service
launchctl kickstart -k gui/$(id -u)/local.style-agent.demo
launchctl bootout gui/$(id -u)/local.style-agent.demo
```

The installer creates a **user-login LaunchAgent**, not a system daemon. It launches Node through `deploy/macos.sb`, permits only the engine executable as a child, denies private project files, and limits writes to `var/`. Crashes restart automatically. A reboot before user login and OS sleep settings still require operator configuration.

Logs rotate at 1 MB. The local daily call count persists in `var/budget.json`. Do not expose the raw port publicly; use an HTTPS reverse proxy and an explicit `PUBLIC_ORIGIN` if choosing this deployment mode.

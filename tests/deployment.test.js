import test from "node:test";
import assert from "node:assert/strict";
import { Sessions } from "../src/server/session.js";
import { sharedQuota } from "../src/server/shared-quota.js";
import { Budget } from "../src/adapters/providers.js";
test("signed sessions survive routing to another instance and reject tampering", () => {
  const a = new Sessions("a".repeat(32)),
    b = new Sessions("a".repeat(32)),
    other = new Sessions("b".repeat(32));
  const now = Date.now(),
    session = a.issue(now);
  assert.equal(b.read(session.token, now).csrf, session.csrf);
  assert.equal(other.read(session.token, now), null);
  assert.equal(b.read(session.token.slice(0, -1) + "x", now), null);
  assert.equal(b.read(session.token, now + 1_800_001), null);
});
test("Vercel quota fails closed without Redis and respects shared limits", async () => {
  await assert.rejects(sharedQuota({})(20, 5), {
    code: "shared_budget_not_configured",
  });
  for (const [result, code] of [
    [1, "daily_budget"],
    [2, "minute_budget"],
    [null, "shared_budget_unavailable"],
  ]) {
    const reserve = sharedQuota(
      {
        UPSTASH_REDIS_REST_URL: "https://example.upstash.io",
        UPSTASH_REDIS_REST_TOKEN: "test",
      },
      async () => new Response(JSON.stringify({ result })),
    );
    await assert.rejects(reserve(20, 5), { code });
  }
  let calls = 0;
  const budget = new Budget({ reserve: sharedQuota({}) });
  await assert.rejects(budget.run(async () => calls++));
  assert.equal(calls, 0);
  assert.equal(budget.active, 0);
});

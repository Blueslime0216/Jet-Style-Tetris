import { ProviderError, fetchJSON } from "../adapters/providers.js";

// Atomic across Vercel instances. No provider calls when shared quota is unavailable.
export function sharedQuota(cfg, fetcher = fetch) {
  return async (limit, perMinute) => {
    const url = cfg.UPSTASH_REDIS_REST_URL,
      token = cfg.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) throw new ProviderError("shared_budget_not_configured");
    const endpoint = new URL(url);
    if (
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password
    )
      throw new ProviderError("shared_budget_config");
    const now = Date.now(),
      day = new Date(now).toISOString().slice(0, 10);
    const script = `local d=tonumber(redis.call('GET',KEYS[1]) or '0') local m=tonumber(redis.call('GET',KEYS[2]) or '0') if d>=tonumber(ARGV[1]) then return 1 end if m>=tonumber(ARGV[2]) then return 2 end redis.call('INCR',KEYS[1]) redis.call('EXPIRE',KEYS[1],172800) redis.call('INCR',KEYS[2]) redis.call('EXPIRE',KEYS[2],120) return 0`;
    let result;
    try {
      result = await fetchJSON(
        endpoint,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            "EVAL",
            script,
            "2",
            `style-agent:day:${day}`,
            `style-agent:minute:${Math.floor(now / 60000)}`,
            String(limit),
            String(perMinute),
          ]),
        },
        1500,
        fetcher,
      );
    } catch {
      throw new ProviderError("shared_budget_unavailable");
    }
    if (result.result === 1) throw new ProviderError("daily_budget");
    if (result.result === 2) throw new ProviderError("minute_budget");
    if (result.result !== 0)
      throw new ProviderError("shared_budget_unavailable");
  };
}

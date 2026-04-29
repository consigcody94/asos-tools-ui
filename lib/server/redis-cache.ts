/** Lazy Redis client.
 *
 *  Used as a warm-restore cache for scan results so the network status
 *  layer survives `owl.service` restarts. ASOS METARs only update
 *  hourly anyway — going from "everything green" to "all NO DATA" the
 *  moment we redeploy is a worse operator experience than serving
 *  slightly-stale state until the first real scan finishes.
 *
 *  When REDIS_URL is unset (e.g. local dev without Redis), every
 *  function returns null without throwing.
 */

import type { RedisClientType } from "redis";

let client: RedisClientType | null = null;
let connecting: Promise<RedisClientType | null> | null = null;

async function getClient(): Promise<RedisClientType | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client && client.isOpen) return client;
  if (connecting) return connecting;

  connecting = (async () => {
    try {
      const redis = await import("redis");
      const c = redis.createClient({ url, socket: { reconnectStrategy: 5000 } });
      c.on("error", (err) => {
        console.warn("[redis] client error:", (err as Error).message);
      });
      await c.connect();
      client = c as RedisClientType;
      return client;
    } catch (err) {
      console.warn("[redis] connect failed:", (err as Error).message);
      return null;
    } finally {
      connecting = null;
    }
  })();

  return connecting;
}

export async function redisGet(key: string): Promise<string | null> {
  const c = await getClient();
  if (!c) return null;
  try {
    return await c.get(key);
  } catch (err) {
    console.warn(`[redis] get(${key}) failed:`, (err as Error).message);
    return null;
  }
}

export async function redisSet(key: string, value: string, ttlSeconds = 0): Promise<boolean> {
  const c = await getClient();
  if (!c) return false;
  try {
    if (ttlSeconds > 0) await c.set(key, value, { EX: ttlSeconds });
    else await c.set(key, value);
    return true;
  } catch (err) {
    console.warn(`[redis] set(${key}) failed:`, (err as Error).message);
    return false;
  }
}

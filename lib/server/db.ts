/** Lazy Postgres client.
 *
 *  When DATABASE_URL is unset (e.g. local dev without Postgres), every
 *  exported function becomes a safe no-op. This keeps the app bootable
 *  without forcing operators to spin up Postgres just to use the read
 *  paths.
 */

import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

let pool: Pool | null = null;
let attempted = false;

function getPool(): Pool | null {
  if (attempted) return pool;
  attempted = true;
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  try {
    // Dynamic require so the missing-env path never has to load pg.
    const pg = require("pg") as typeof import("pg");
    pool = new pg.Pool({
      connectionString: url,
      max: Number(process.env.PG_POOL_MAX ?? 8),
      idleTimeoutMillis: 30_000,
    });
    pool.on("error", (err) => {
      console.error("[db] idle client error:", err.message);
    });
  } catch (err) {
    console.error("[db] failed to construct pool:", (err as Error).message);
    pool = null;
  }
  return pool;
}

export function dbAvailable(): boolean {
  return getPool() != null;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<QueryResult<T> | null> {
  const p = getPool();
  if (!p) return null;
  try {
    return await p.query<T>(sql, params);
  } catch (err) {
    console.error("[db] query failed:", (err as Error).message);
    return null;
  }
}

export async function withClient<T>(fn: (c: PoolClient) => Promise<T>): Promise<T | null> {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

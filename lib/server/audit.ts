/** Operator audit log — append-only. Backed by the `audit_events` table.
 *
 *  Every operator-driven side effect (cache flush, manual refresh, role
 *  change) calls `record(...)`. The Admin UI calls `recent(...)` to render
 *  the rolling history.
 *
 *  When DATABASE_URL is not set we fall back to an in-memory ring buffer so
 *  local dev surfaces the same shape — but the buffer obviously does not
 *  survive process restarts.
 */

import { dbAvailable, query } from "./db";

export interface AuditEvent {
  id: number;
  created_at: string;
  actor: string;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
}

const memBuffer: AuditEvent[] = [];
let memId = 0;

export async function record(
  action: string,
  target: string | null = null,
  metadata: Record<string, unknown> = {},
  actor: string = "system",
): Promise<void> {
  if (dbAvailable()) {
    await query(
      `INSERT INTO audit_events (actor, action, target, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [actor, action, target, JSON.stringify(metadata)],
    );
    return;
  }
  memBuffer.unshift({
    id: ++memId,
    created_at: new Date().toISOString(),
    actor,
    action,
    target,
    metadata,
  });
  if (memBuffer.length > 200) memBuffer.length = 200;
}

export async function recent(limit = 50): Promise<AuditEvent[]> {
  const safe = Math.max(1, Math.min(500, limit));
  if (dbAvailable()) {
    const result = await query<AuditEvent>(
      `SELECT id, created_at, actor, action, target, metadata
       FROM audit_events
       ORDER BY id DESC
       LIMIT $1`,
      [safe],
    );
    return result?.rows.map((row) => ({
      ...row,
      created_at: new Date(row.created_at).toISOString(),
    })) ?? [];
  }
  return memBuffer.slice(0, safe);
}

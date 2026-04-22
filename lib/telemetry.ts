/** Application Insights wiring — server-only.
 *
 *  Loaded once at module import time.  Auto-instruments Node fetch,
 *  HTTP servers, console, and unhandled exceptions.  Custom metrics
 *  use the public `track*` helpers below.
 *
 *  Connection string is read from APPLICATIONINSIGHTS_CONNECTION_STRING
 *  (Azure Container Apps env var; injected at deploy time).  When unset
 *  (local dev), the SDK no-ops cleanly so we never crash on missing
 *  config.
 */

import * as appInsights from "applicationinsights";

const conn = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING || "";

let started = false;
function ensureStarted() {
  if (started || !conn) return;
  started = true;
  try {
    appInsights
      .setup(conn)
      .setAutoCollectRequests(true)
      .setAutoCollectPerformance(true, true)
      .setAutoCollectExceptions(true)
      .setAutoCollectDependencies(true)
      .setAutoCollectConsole(false)        // we already log in our own format
      .setSendLiveMetrics(false)
      .setUseDiskRetryCaching(true)
      .start();
    appInsights.defaultClient.context.tags[
      appInsights.defaultClient.context.keys.cloudRole
    ] = "owl-ui";
  } catch (e) {
    /* never let telemetry crash the app */
    console.warn("[telemetry] init failed:", e);
  }
}

ensureStarted();

/** Track a custom event (one record per call). */
export function trackEvent(
  name: string,
  properties?: Record<string, string | number | boolean>,
) {
  if (!conn) return;
  try {
    const props: Record<string, string> = {};
    if (properties) {
      for (const [k, v] of Object.entries(properties)) props[k] = String(v);
    }
    appInsights.defaultClient?.trackEvent({ name, properties: props });
  } catch { /* swallow */ }
}

/** Track a custom numeric metric (aggregated server-side). */
export function trackMetric(name: string, value: number) {
  if (!conn) return;
  try {
    appInsights.defaultClient?.trackMetric({ name, value });
  } catch { /* swallow */ }
}

/** Track an exception. */
export function trackException(err: unknown, properties?: Record<string, string>) {
  if (!conn) return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    appInsights.defaultClient?.trackException({ exception: e, properties });
  } catch { /* swallow */ }
}

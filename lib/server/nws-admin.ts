/** NWS NCEP SDM Administrative Messages (NOUS42 KWNO / ADASDM).
 *
 *  Per the NWS API documentation: "Information on outages is generally
 *  communicated through Administrative messages sent by NCEP's Senior
 *  Duty Meteorologist (SDM). These are sent via WMO id NOUS42 KWNO and
 *  product identifier ADASDM."
 *
 *  These bulletins are how NWS itself announces:
 *    - Region-wide CAP outages
 *    - NWS api.weather.gov degradations
 *    - NEXRAD outages
 *    - Upper-air sounding cancellations
 *    - Buoy network problems
 *    - Anything operations need to know about NWS systems
 *
 *  We poll the latest ADASDM product, surface it as an OWL ops banner,
 *  and stamp the timestamp so operators know whether they're looking
 *  at fresh news or a stale advisory.
 *
 *  Endpoint shape: api.weather.gov exposes products via
 *    /products/types/ADASDM/locations/KWNO  →  list of recent products
 *    /products/{id}                          →  product text body
 *
 *  Fail-safe: any error returns null. The banner is meta-information,
 *  never a load-bearing dependency for operator workflow.
 */

import { fetchJson } from "./fetcher";
import { NWS_DEFAULT_HEADERS } from "./nws";

const BASE = "https://api.weather.gov";
const TYPE = "ADASDM";   // Administrative Daily / Senior Duty Meteorologist
const ISSUER = "KWNO";   // NCEP HQ, Maryland

export interface AdminMessage {
  id: string;
  issued: string;          // ISO timestamp from NWS
  text: string;            // raw bulletin text
  preview: string;         // first ~280 chars for the banner
  source: "NCEP-SDM";
  product: typeof TYPE;
}

interface ProductsListItem {
  id?: string;
  issuanceTime?: string;
  productCode?: string;
}

interface ProductPayload {
  id?: string;
  issuanceTime?: string;
  productText?: string;
}

let _cache: { at: number; msg: AdminMessage | null } | null = null;
// Admin messages are issued ad-hoc — usually a few times per day during
// operational events, sometimes none for days. 5-min cache covers a
// "load + scroll" page session without hammering NWS for a feed that
// changes glacially relative to our scan cycle.
const TTL_MS = 5 * 60 * 1000;

/** Return the most recent NCEP SDM admin message, or null if none. */
export async function getLatestAdminMessage(): Promise<AdminMessage | null> {
  if (_cache && Date.now() - _cache.at < TTL_MS) {
    return _cache.msg;
  }
  try {
    // Step 1: list recent products of type ADASDM from KWNO.
    const list = await fetchJson<{ "@graph"?: ProductsListItem[] }>(
      `${BASE}/products/types/${TYPE}/locations/${ISSUER}`,
      { headers: NWS_DEFAULT_HEADERS, timeoutMs: 10_000, retries: 1 },
    );
    const items = list?.["@graph"] ?? [];
    if (items.length === 0) {
      _cache = { at: Date.now(), msg: null };
      return null;
    }
    // Step 2: fetch the body of the most recent product. The list is
    // sorted newest-first by NWS.
    const latest = items[0];
    if (!latest.id) {
      _cache = { at: Date.now(), msg: null };
      return null;
    }
    const product = await fetchJson<ProductPayload>(
      `${BASE}/products/${latest.id}`,
      { headers: NWS_DEFAULT_HEADERS, timeoutMs: 10_000, retries: 1 },
    );
    if (!product?.productText) {
      _cache = { at: Date.now(), msg: null };
      return null;
    }
    const text = String(product.productText).trim();
    const msg: AdminMessage = {
      id: String(product.id || latest.id),
      issued: String(product.issuanceTime || latest.issuanceTime || new Date().toISOString()),
      text,
      preview: text.slice(0, 280),
      source: "NCEP-SDM",
      product: TYPE,
    };
    _cache = { at: Date.now(), msg };
    return msg;
  } catch (err) {
    console.warn("[nws-admin] fetch failed:", (err as Error).message);
    return _cache?.msg ?? null;
  }
}

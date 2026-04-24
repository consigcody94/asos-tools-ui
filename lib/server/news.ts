/** Aggregate NOAA / FAA / NTSB / AWC / NHC news RSS feeds for the ticker.
 *  All RSS feeds pass through the shared rate-limited fetcher
 *  (1 req/s per host — these feeds publish infrequently anyway).
 */

import { fetchText, fetchJson } from "./fetcher";

interface Feed { name: string; url: string; severity?: "info" | "warn" | "crit"; }

const FEEDS: Feed[] = [
  { name: "NOAA",  url: "https://www.noaa.gov/feed/media-release",  severity: "info" },
  { name: "FAA",   url: "https://www.faa.gov/newsroom/rss",         severity: "info" },
  { name: "NTSB",  url: "https://www.ntsb.gov/rss/news.aspx",       severity: "warn" },
  { name: "NWS",   url: "https://www.weather.gov/rss-news",         severity: "info" },
];

export interface NewsItem {
  source: string;
  title: string;
  link: string;
  published_iso: string;
  severity: "info" | "warn" | "crit";
}

function parseRssItems(xml: string, source: string, severity: NewsItem["severity"]): NewsItem[] {
  const items: NewsItem[] = [];
  const regex = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(xml)) !== null) {
    const body = m[2];
    const title = extract(body, "title");
    const link = extractLink(body);
    const pub = extract(body, "pubDate") || extract(body, "updated") || extract(body, "published") || "";
    if (!title || !link) continue;
    items.push({
      source,
      title: decodeHtml(title),
      link,
      published_iso: pub ? new Date(pub).toISOString() : "",
      severity,
    });
  }
  return items;
}

function extract(xml: string, tag: string): string {
  const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const m = xml.match(r);
  if (!m) return "";
  return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").trim();
}

function extractLink(xml: string): string {
  const atom = xml.match(/<link\b[^>]*href=["']([^"']+)["']/i);
  if (atom) return atom[1];
  return extract(xml, "link");
}

function decodeHtml(s: string): string {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .trim();
}

async function fetchSwpcAlerts(): Promise<NewsItem[]> {
  const data = await fetchJson<Array<{ message?: string; issue_datetime?: string; product_id?: string }>>(
    "https://services.swpc.noaa.gov/products/alerts.json", { timeoutMs: 15_000 },
  );
  if (!data) return [];
  return data.slice(0, 8).map((a) => ({
    source: "SWPC",
    title: (a.message || "").split("\n")[0].slice(0, 160),
    link: "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
    published_iso: a.issue_datetime ? new Date(a.issue_datetime).toISOString() : "",
    severity: "warn" as const,
  }));
}

export async function fetchNews(limit = 30): Promise<NewsItem[]> {
  const tasks: Promise<NewsItem[]>[] = FEEDS.map(async (f) => {
    const xml = await fetchText(f.url, {
      timeoutMs: 15_000,
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
    });
    if (!xml) return [];
    return parseRssItems(xml, f.name, f.severity ?? "info");
  });
  tasks.push(fetchSwpcAlerts());
  const nested = await Promise.all(tasks);
  const all = nested.flat();
  all.sort((a, b) => (b.published_iso || "").localeCompare(a.published_iso || ""));
  return all.slice(0, limit);
}

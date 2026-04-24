/** Aggregate NOAA / FAA / NTSB / AWC / NHC news RSS feeds for the ticker.
 *  Uses a tiny purpose-built XML parser — no rss-parser dep.
 */

const UA = "owl-ui/2.0 (asos-tools-ui)";

interface Feed { name: string; url: string; severity?: "info" | "warn" | "crit"; }

const FEEDS: Feed[] = [
  { name: "NOAA",  url: "https://www.noaa.gov/feed/media-release",     severity: "info" },
  { name: "FAA",   url: "https://www.faa.gov/newsroom/rss",            severity: "info" },
  { name: "NTSB",  url: "https://www.ntsb.gov/rss/news.aspx",          severity: "warn" },
  { name: "NWS",   url: "https://www.weather.gov/rss-news",            severity: "info" },
  { name: "SWPC",  url: "https://services.swpc.noaa.gov/products/alerts.json", severity: "warn" }, // handled specially below
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
  // Covers both <item> and <entry> (RSS / Atom).
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
  // Atom: <link href="..." />  |  RSS: <link>...</link>
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
  try {
    const r = await fetch("https://services.swpc.noaa.gov/products/alerts.json", {
      headers: { "User-Agent": UA, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
      next: { revalidate: 600 },
    });
    if (!r.ok) return [];
    const data = (await r.json()) as Array<{ message?: string; issue_datetime?: string; product_id?: string }>;
    return data.slice(0, 8).map((a) => ({
      source: "SWPC",
      title: (a.message || "").split("\n")[0].slice(0, 160),
      link: "https://www.swpc.noaa.gov/products/alerts-watches-and-warnings",
      published_iso: a.issue_datetime ? new Date(a.issue_datetime).toISOString() : "",
      severity: "warn" as const,
    }));
  } catch { return []; }
}

export async function fetchNews(limit = 30): Promise<NewsItem[]> {
  const tasks: Promise<NewsItem[]>[] = FEEDS
    .filter((f) => f.name !== "SWPC")
    .map(async (f) => {
      try {
        const r = await fetch(f.url, {
          headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml" },
          signal: AbortSignal.timeout(10_000),
          next: { revalidate: 300 },
        });
        if (!r.ok) return [];
        const xml = await r.text();
        return parseRssItems(xml, f.name, f.severity ?? "info");
      } catch { return []; }
    });
  tasks.push(fetchSwpcAlerts());
  const nested = await Promise.all(tasks);
  const all = nested.flat();
  all.sort((a, b) => (b.published_iso || "").localeCompare(a.published_iso || ""));
  return all.slice(0, limit);
}

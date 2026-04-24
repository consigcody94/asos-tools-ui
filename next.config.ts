import type { NextConfig } from "next";

/** O.W.L. Next.js config.
 *
 *  - `output: "standalone"` emits a self-contained build bundle for
 *    Azure Container Apps / Vercel / Docker — no runtime npm install.
 *  - `images.remotePatterns` allowlists upstream image CDNs we render:
 *    FAA WeatherCams, NESDIS GOES, IEM radar, NWS RIDGE (radar.weather.gov).
 *  - Everything ASOS-related is server-side in `lib/server/*` and served
 *    through this app's own `/api/*` routes — no external backend.
 */
const config: NextConfig = {
  output: "standalone",
  reactStrictMode: true,
  // App Insights has optional native deps (mysql/postgres/oracle hooks)
  // that we don't use; externalising it stops Webpack from trying to
  // resolve them during the bundle.
  serverExternalPackages: ["applicationinsights", "diagnostic-channel-publishers"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "*.faa.gov" },
      { protocol: "https", hostname: "*.noaa.gov" },
      { protocol: "https", hostname: "*.nesdis.noaa.gov" },
      { protocol: "https", hostname: "*.weather.gov" },
      { protocol: "https", hostname: "cdn.star.nesdis.noaa.gov" },
      { protocol: "https", hostname: "radar.weather.gov" },
      { protocol: "https", hostname: "images.wcams-static.faa.gov" },
      { protocol: "https", hostname: "weathercams.faa.gov" },
      { protocol: "https", hostname: "mesonet.agron.iastate.edu" },
      { protocol: "https", hostname: "www.nhc.noaa.gov" },
      { protocol: "https", hostname: "earthquake.usgs.gov" },
      { protocol: "https", hostname: "www.ndbc.noaa.gov" },
    ],
  },
  // Strict cross-origin headers so the page itself can't be embedded
  // anywhere we don't expect, while still allowing our globe iframe
  // and the FAA/NOAA images to load.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "geolocation=(), microphone=(), camera=()",
          },
        ],
      },
    ];
  },
};

export default config;

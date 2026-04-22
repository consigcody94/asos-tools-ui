import type { NextConfig } from "next";

/** O.W.L. Next.js config.
 *
 *  - `output: "standalone"` makes the build deploy-clean on Vercel (no
 *    surprises) and also lets us containerise it later if we ever need to.
 *  - `OWL_API_BASE` env var points at the existing HF Space FastAPI sidecar.
 *    The default is the public Space; override per-environment in Vercel.
 *  - `images.remotePatterns` allowlists the upstream image CDNs we
 *    render from: FAA WeatherCams, NESDIS GOES, IEM radar.
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
      { protocol: "https", hostname: "cdn.star.nesdis.noaa.gov" },
      { protocol: "https", hostname: "images.wcams-static.faa.gov" },
      { protocol: "https", hostname: "weathercams.faa.gov" },
      { protocol: "https", hostname: "mesonet.agron.iastate.edu" },
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

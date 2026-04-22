import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { NewsTicker } from "@/components/news-ticker";

export const metadata: Metadata = {
  title: "O.W.L. — Observation Watch Log",
  description:
    "ASOS network observation & maintenance monitor. " +
    "920 stations, live globe, FAA WeatherCam loops, NESDIS GOES satellite, " +
    "AWC METAR/TAF/SIGMET, NWS CAP alerts.",
  applicationName: "O.W.L.",
  authors: [{ name: "Cody" }],
};

export const viewport: Viewport = {
  themeColor: "#050816",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // The pulse data is fetched in app/page.tsx (server component) and
  // passed down through context-free prop drilling.  We render the
  // sidebar here without it for now and feed it via SWR-style
  // re-render on the index page.  Simple + correct.
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-dvh">
          <Sidebar />
          <main className="flex-1 px-6 py-4 pb-12 max-w-[1640px]">{children}</main>
        </div>
        <NewsTicker />
      </body>
    </html>
  );
}

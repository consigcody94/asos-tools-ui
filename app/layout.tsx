import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Sidebar } from "@/components/sidebar";
import { NewsTicker } from "@/components/news-ticker";
import { CommandPalette } from "@/components/command-palette";

export const metadata: Metadata = {
  title: "OWL — Observation Watch Log",
  description:
    "ASOS network operations console. 920 NWS / FAA / DOD weather stations, " +
    "live network scan, FAA WeatherCam loops, NWS NEXRAD radar, NESDIS GOES " +
    "satellite, AWC aviation hazards, NWS CAP alerts, USGS earthquakes, NHC " +
    "tropical cyclones, NDBC buoys, NOAA SWPC space weather.",
  applicationName: "OWL",
  authors: [{ name: "Cody Churchwell", url: "mailto:cto@sentinelowl.org" }],
};

export const viewport: Viewport = {
  themeColor: "#0b1220",
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <div className="flex min-h-dvh">
          <Sidebar />
          <main className="flex-1 px-6 py-4 pb-12 max-w-[1640px]">{children}</main>
        </div>
        <NewsTicker />
        <CommandPalette />
      </body>
    </html>
  );
}

"use client";

/** OWL brand logo — animated video logo + text (composited inside the video).
 *
 *  The video carries both the mark and the name, so we render the video
 *  as the entire brand element. Behavior:
 *
 *    - Plays ONCE on page load and freezes on the final frame.
 *      No looping — operators see the intro animation when they load
 *      the app, then the static end-state for the rest of the session.
 *
 *    - Autoplay, muted, playsinline. Audio is stripped during asset
 *      processing (logos shouldn't make sound), but `muted` is also
 *      required on the element for autoplay to be allowed by modern
 *      browsers (Chrome 66+, Safari 11+).
 *
 *    - WebM source has VP9 alpha so the black-square background of the
 *      raw video is replaced by true transparency on Chrome / Firefox /
 *      Edge. The MP4 fallback (Safari / older WebKit) keeps its black
 *      bg, which we hide on dark surfaces via `mix-blend-mode: lighten`
 *      — black + dark = dark, so the bg becomes visually invisible.
 *
 *    - <img> poster fallback (PNG with transparency) for users with
 *      reduced-motion, very old browsers, or no JS. Same dimensions
 *      as the video so layout never shifts.
 *
 *    - Honors `prefers-reduced-motion` — those users see the static
 *      poster, no animation.
 *
 *    - Width is configurable via `size` (px). Default 80; sidebar
 *      uses ~180; page headers use ~240.
 */

import { useEffect, useState } from "react";

interface Props {
  /** Pixel width of the rendered logo. Height is derived from the
   *  video's intrinsic 16:9 aspect ratio. */
  size?: number;
  /** Optional className for the wrapper (e.g., margin / shadow). */
  className?: string;
  /** When true, force the static poster (no video). Used in places
   *  where animation would be distracting (e.g., a printed report). */
  staticOnly?: boolean;
  /** Alt text for the poster fallback. Default: "OWL". */
  alt?: string;
}

export function BrandLogo({
  size = 80,
  className,
  staticOnly = false,
  alt = "OWL",
}: Props) {
  const [reducedMotion, setReducedMotion] = useState(false);

  // Subscribe to prefers-reduced-motion so flipping the OS setting
  // updates the logo without a page reload. SSR-safe via the
  // `typeof window` guard.
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const listener = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  // Height: 16:9 — matches the source video aspect.
  const height = Math.round((size * 9) / 16);

  if (staticOnly || reducedMotion) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={size <= 240 ? "/brand/logo-poster-sm.png" : "/brand/logo-poster.png"}
        alt={alt}
        width={size}
        height={height}
        className={className}
        style={{ display: "block", objectFit: "contain" }}
      />
    );
  }

  return (
    <video
      width={size}
      height={height}
      autoPlay
      muted
      playsInline
      preload="auto"
      poster="/brand/logo-poster.png"
      aria-label={alt}
      className={className}
      style={{
        display: "block",
        objectFit: "contain",
        // Safari / older WebKit fall back to MP4 which keeps a black
        // background; mix-blend-mode: lighten makes that black drop
        // out visually against the dark sidebar surface. Chromium/
        // Firefox use the WebM with true VP9 alpha so the blend mode
        // is a visual no-op for them — same end result everywhere.
        mixBlendMode: "lighten",
      }}
    >
      <source src="/brand/logo.webm" type="video/webm" />
      <source src="/brand/logo.mp4" type="video/mp4" />
    </video>
  );
}

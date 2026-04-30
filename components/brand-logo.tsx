"use client";

/** OWL brand logo — animated video logo + text (composited inside the video).
 *
 *  The video carries both the mark and the name, so we render the video
 *  as the entire brand element. Behavior:
 *
 *    - Autoplay, muted, looping, playsinline. Audio is stripped during
 *      asset processing (logos shouldn't make sound), but `muted` is
 *      ALSO required on the element for autoplay to be allowed by
 *      modern browsers (Chrome 66+, Safari 11+).
 *
 *    - Two source tags: WebM (VP9, smaller) preferred, MP4 (H.264)
 *      fallback. Saves ~150 KB on most modern browsers.
 *
 *    - `<img>` poster fallback for users with reduced-motion, very old
 *      browsers, or no JS. Same dimensions as the video so layout
 *      doesn't shift between fallback and video-load.
 *
 *    - Honors `prefers-reduced-motion` — when a user has that
 *      accessibility setting on, we render the static poster instead
 *      of the looping animation.
 *
 *    - Width is configurable via `size` (px). Default 80px wide;
 *      sidebar uses ~120px, page headers use ~200px.
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
        src={size <= 240 ? "/brand/logo-poster-sm.jpg" : "/brand/logo-poster.jpg"}
        alt={alt}
        width={size}
        height={height}
        className={className}
        style={{ display: "block", borderRadius: 6, objectFit: "cover" }}
      />
    );
  }

  return (
    <video
      width={size}
      height={height}
      autoPlay
      loop
      muted
      playsInline
      preload="metadata"
      poster="/brand/logo-poster.jpg"
      aria-label={alt}
      className={className}
      style={{ display: "block", borderRadius: 6, objectFit: "cover" }}
    >
      <source src="/brand/logo.webm" type="video/webm" />
      <source src="/brand/logo.mp4" type="video/mp4" />
    </video>
  );
}

"use client";

import { useEffect, useRef } from "react";

/// A silent looping capture that behaves like an animated screenshot.
///
/// `preload="none"` is the point: the three captures on this page are ~7MB
/// together, and eagerly loading them would compete with the hero image for
/// the first screen. The poster is what makes that free — the tile is a still
/// frame from the first byte, and the video swaps in when it is nearly in
/// view. Playback pauses off-screen so decode work tracks what is visible.
export function LazyVideo({
  src,
  poster,
  alt,
  className,
}: {
  src: string;
  poster: string;
  alt: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // A looping clip nobody asked for is exactly what this setting is about,
    // so reduced motion gets the poster plus controls instead: the capture is
    // still reachable, it just waits to be asked for.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.controls = true;
      el.preload = "metadata";
      return;
    }

    const io = new IntersectionObserver(
      ([entry]) => {
        // `play()` rejects when the tab is backgrounded or the element is
        // torn down mid-load. Neither is worth reporting — the poster stands.
        if (entry.isIntersecting) void el.play().catch(() => {});
        else el.pause();
      },
      // Start the fetch a screen early so the swap from poster to motion has
      // landed by the time the tile is actually being looked at.
      { rootMargin: "300px" },
    );

    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <video
      ref={ref}
      src={src}
      poster={poster}
      aria-label={alt}
      muted
      loop
      playsInline
      preload="none"
      className={className}
    />
  );
}

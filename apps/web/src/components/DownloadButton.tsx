"use client";

import { posthog } from "@/lib/posthog";
import { AppleGlyph } from "@/components/AppleGlyph";
import { DOWNLOAD, WINDOWS_DOWNLOAD } from "@/lib/links";
import { useEffect, useState } from "react";

/// The download link, split out as a client component so the click can be
/// counted.
///
/// **`sendBeacon` is kept even though the new tab means this page no longer
/// unloads.** It was load-bearing when the href navigated in place — the
/// default transport is a request the browser is free to cancel as the page
/// goes. It costs nothing now and it is what stops the event disappearing
/// silently if `target` is ever dropped again.
export function DownloadButton({ className, label }: { className?: string; label?: string }) {
  const [windows, setWindows] = useState(false);
  useEffect(() => setWindows(/Win/.test(navigator.platform)), []);
  return (
    <a
      href={windows ? WINDOWS_DOWNLOAD : DOWNLOAD}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() =>
        posthog.capture("download", { platform: windows ? "windows" : "macos" }, { transport: "sendBeacon" })
      }
      className={className ?? "inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"}
    >
      {!windows && <AppleGlyph className="size-4" />}
      {label ?? `Download for ${windows ? "Windows" : "macOS"}`}
    </a>
  );
}

import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { LinkSafetyModalProps } from "streamdown";

import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/// The confirm a transcript link opens, in place of Streamdown's own.
///
/// Its modal is replaced rather than restyled because its Open button calls
/// `window.open`, which a Tauri webview answers by doing nothing at all — no
/// error, no navigation, so the dialog reads as a dead button next to a Copy
/// link that works. The route out of the app is `openUrl`, the same one the PR
/// panel takes, and `onConfirm` is therefore deliberately unused.
export default function LinkDialog({ url, isOpen, onClose }: LinkSafetyModalProps) {
  const [copied, setCopied] = useState(false);

  // Reset on open, not on close: Radix keeps `Content` mounted through the
  // fade, so clearing it on the way out swaps the button back for that frame.
  useEffect(() => {
    if (isOpen) setCopied(false);
  }, [isOpen]);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const copy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  };

  const open = async () => {
    try {
      await openUrl(url);
    } catch (err) {
      console.error("failed to open link", err);
    }
    onClose();
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={(next) => !next && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Open this link?</AlertDialogTitle>
          <AlertDialogDescription>It opens in your default browser.</AlertDialogDescription>
        </AlertDialogHeader>
        {/* The whole URL, wrapping and scrolling rather than truncating — the
            host is the reason to show it and the tail is where a link lies. */}
        <div className="max-h-32 overflow-y-auto rounded-md bg-muted p-3 font-mono text-ui break-all">
          {url}
        </div>
        <AlertDialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="text-ui sm:mr-auto"
            onClick={() => void copy()}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            // Radix closes on click; `preventDefault` holds it open until the
            // opener has answered, so a failure closes through `open` alone.
            onClick={(e) => {
              e.preventDefault();
              void open();
            }}
          >
            <ExternalLink />
            Open link
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

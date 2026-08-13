import { Download, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { UpdateStatus } from "@/types/events";

type UpdateRowProps = {
  status: UpdateStatus | null;
  /// A turn is in flight somewhere. Installing swaps the bundle and relaunches,
  /// which kills the child mid-turn, so the button waits rather than warning.
  blocked: boolean;
  onInstall: () => void;
};

/// The update notice, pinned to the sidebar's bottom edge.
///
/// Drawn only while there is something to say — the sidebar has no permanent
/// footer, and a row that reads "up to date" is chrome for a fact nobody asked
/// about. Nothing shows while the sidebar is collapsed; the next check keeps
/// the offer alive, and an update is not urgent enough to earn a second home in
/// the header.
export default function UpdateRow({ status, blocked, onInstall }: UpdateRowProps) {
  if (!status) return null;

  if (status.state === "downloading") {
    return (
      <Footer>
        <div className="flex items-center gap-2 px-1.5 py-1 text-ui text-muted-foreground">
          <Download className="size-4 shrink-0" />
          <span className="truncate">Downloading v{status.version}</span>
          {status.percent !== null && (
            <span className="ml-auto tabular-nums">{status.percent}%</span>
          )}
        </div>
      </Footer>
    );
  }

  return (
    <Footer>
      <Button
        variant="ghost"
        size="sm"
        disabled={blocked}
        onClick={onInstall}
        className="w-full justify-start px-1.5 text-ui"
      >
        <RotateCw />
        Restart to update
        <span className="ml-auto text-muted-foreground tabular-nums">
          v{status.version}
        </span>
      </Button>
      {blocked && (
        <p className="px-1.5 pt-1 text-ui text-muted-foreground">
          Waiting for the running task to finish.
        </p>
      )}
    </Footer>
  );
}

function Footer({ children }: { children: React.ReactNode }) {
  return <div className="shrink-0 px-2 py-2">{children}</div>;
}

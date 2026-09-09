import { useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

type UpdateState = {
  version: string;
  phase: "downloading" | "ready" | "installing" | "error";
  downloaded: number;
  total: number | null;
};

function downloadLabel(state: UpdateState): string {
  if (state.phase !== "downloading") return "Downloading…";
  if (!state.total) return "Downloading…";
  return `Downloading ${Math.min(100, Math.round((state.downloaded / state.total) * 100))}%`;
}

/**
 * Checks GitHub Releases once at launch and downloads a signed update in the
 * background. Installation stays behind an explicit restart action so an
 * update never interrupts work merely because it became available.
 */
export default function UpdateNotice() {
  const updateRef = useRef<Update | null>(null);
  const [state, setState] = useState<UpdateState | null>(null);

  const download = async (update: Update) => {
    let downloaded = 0;
    let total: number | null = null;
    setState({ version: update.version, phase: "downloading", downloaded, total });

    try {
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
        }
        setState({ version: update.version, phase: "downloading", downloaded, total });
      });
      setState({ version: update.version, phase: "ready", downloaded, total });
    } catch (error) {
      console.error("Failed to download the app update", error);
      setState({ version: update.version, phase: "error", downloaded, total });
    }
  };

  useEffect(() => {
    // The development binary has no release bundle to replace and should not
    // contact the production update endpoint on every hot reload.
    if (import.meta.env.DEV) return;

    let active = true;
    void check({ timeout: 30_000 })
      .then((update) => {
        if (!active || !update) return;
        updateRef.current = update;
        return download(update);
      })
      .catch((error) => console.error("Failed to check for app updates", error));

    return () => {
      active = false;
    };
  }, []);

  const install = async () => {
    const update = updateRef.current;
    if (!update || state?.phase !== "ready") return;

    setState({ ...state, phase: "installing" });
    try {
      // Stop managed agent processes before handing control to the installer.
      // Windows exits after launching it; macOS returns after replacing the app
      // and needs the explicit restart that follows.
      await invoke("prepare_for_update");
      await update.install({ restartAfterInstall: true });
      await invoke("restart_after_update");
    } catch (error) {
      console.error("Failed to install the app update", error);
      setState({ ...state, phase: "error" });
    }
  };

  if (!state) return null;

  const detail =
    state.phase === "ready"
      ? "The update was downloaded and is ready to install."
      : state.phase === "error"
        ? "The update could not be downloaded."
        : state.phase === "installing"
          ? "Installing the update…"
          : "The update is downloading in the background.";

  return (
    <Alert className="fixed right-3 bottom-3 z-50 w-80 shadow-lg animate-in fade-in slide-in-from-bottom-2">
      <AlertTitle>Dray {state.version} is available</AlertTitle>
      <AlertDescription className="mt-1 text-ui-sm text-muted-foreground">
        {detail}
      </AlertDescription>
      <div className="mt-3 flex justify-end">
        {state.phase === "ready" ? (
          <Button size="xs" onClick={() => void install()}>
            Install and restart
          </Button>
        ) : state.phase === "error" ? (
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              if (updateRef.current) void download(updateRef.current);
            }}
          >
            Retry download
          </Button>
        ) : (
          <Button size="xs" variant="secondary" disabled>
            {state.phase === "installing" ? "Installing…" : downloadLabel(state)}
          </Button>
        )}
      </div>
    </Alert>
  );
}

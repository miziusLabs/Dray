import { useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";

import packageJson from "../../package.json";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";

export type UpdateState = {
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
export type UpdateController = {
  state: UpdateState | null;
  install: () => Promise<void>;
  retry: () => void;
  fakeUpdateAvailable: () => void;
};

export function useUpdate(): UpdateController {
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

  const fakeUpdateAvailable = () => {
    if (!import.meta.env.DEV) return;
    setState({
      version: `${packageJson.version}-dev`,
      phase: "ready",
      downloaded: 0,
      total: null,
    });
  };

  const install = async () => {
    const update = updateRef.current;
    if (import.meta.env.DEV && !update && state?.phase === "ready") {
      setState(null);
      return;
    }
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

  return {
    state,
    install,
    retry: () => {
      if (updateRef.current) void download(updateRef.current);
    },
    fakeUpdateAvailable,
  };
}

export default function UpdateNotice({
  controller,
}: {
  controller: UpdateController;
}) {
  const { state, install, retry } = controller;
  if (!state) return null;

  const label =
    state.phase === "ready"
      ? "Install and restart"
      : state.phase === "error"
        ? "Retry download"
        : state.phase === "installing"
          ? "Installing…"
          : downloadLabel(state);
  const disabled = state.phase === "downloading" || state.phase === "installing";

  return (
    <div className="shrink-0 px-2 py-2">
      <Button
        size="sm"
        variant="ghost"
        className="w-full justify-start px-1.5 text-ui"
        disabled={disabled}
        title={`Dray ${state.version}: ${label}`}
        aria-label={`Dray ${state.version}: ${label}`}
        onClick={() => {
          if (state.phase === "ready") void install();
          else if (state.phase === "error") retry();
        }}
      >
        <Download />
        {label}
      </Button>
    </div>
  );
}

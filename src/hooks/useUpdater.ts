import { useCallback, useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { UpdateChannel, UpdateStatus } from "@/types/events";

// Long enough that a session left open for a week still finds an update, short
// enough that it isn't only ever the launch check doing the work.
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/// Checks for an update on launch and on an interval, and holds what the
/// backend reports back.
///
/// `null` is the resting state and covers every failure: a check that can't
/// reach the manifest emits nothing, so no network is silent rather than an
/// error the reader can do nothing about. The channel has no UI yet — it is
/// read from storage so opting into beta is a one-line change when it does.
export function useUpdater() {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [channel] = useLocalStorage<UpdateChannel>("ade.updateChannel", "stable");

  // A downloaded bundle is the end of the road until the app restarts, so the
  // interval stops rather than re-downloading the same version every 6 hours.
  const ready = status?.state === "ready";
  const readyRef = useRef(ready);
  readyRef.current = ready;

  // A check runs the download too, so a second one overlapping the first would
  // fetch the same bundle twice. StrictMode's double effect makes that the
  // normal case in dev rather than a race worth waving at.
  const inFlight = useRef(false);

  useEffect(() => {
    const unlisten = listen<UpdateStatus>("update_status", (event) => {
      setStatus(event.payload);
    });

    const check = () => {
      if (readyRef.current || inFlight.current) return;
      inFlight.current = true;
      void invoke("check_update", { channel })
        .catch((e) => {
          console.warn("[update check]", e);
        })
        .finally(() => {
          inFlight.current = false;
        });
    };

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      void unlisten.then((f) => f());
      clearInterval(timer);
    };
  }, [channel]);

  // Resolving at all means the install failed — the backend relaunches the app
  // on success, so nothing downstream of this ever runs.
  const install = useCallback(
    () =>
      invoke("install_update").catch((e) => {
        console.error("[update install]", e);
      }),
    [],
  );

  return { status, install };
}

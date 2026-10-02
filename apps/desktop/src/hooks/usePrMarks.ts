import { useCallback, useEffect, useRef, useState } from "react";

import { invoke } from "@tauri-apps/api/core";

import { pickPrMark } from "@/lib/pr";
import type { PrMark } from "@/types/events";

const FRESH_MS = 120_000;
const OPEN_POLL_MS = 30_000;

// Keep answers across project switches so returning rows do not blank and refill.
const cache = new Map<string, Map<string, PrMark>>();
const fetchedAt = new Map<string, number>();
const inFlight = new Map<string, Promise<void>>();
const EMPTY: Map<string, PrMark> = new Map();

function marksByBranch(prs: PrMark[]): Map<string, PrMark> {
  const byBranch = new Map<string, PrMark[]>();
  for (const pr of prs) {
    const list = byBranch.get(pr.headRefName);
    if (list) list.push(pr);
    else byBranch.set(pr.headRefName, [pr]);
  }

  return new Map(
    [...byBranch].flatMap(([branch, list]) => {
      const pick = pickPrMark(list);
      return pick ? [[branch, pick] as const] : [];
    }),
  );
}

// One query per visible repository, shared by sidebar marks and ready notices.
// Failures are silent and leave the last good answer and freshness stamp alone.
export function usePrMarks(repoPaths: string[]) {
  const key = [...repoPaths].sort().join("\n");
  const pathsRef = useRef(repoPaths);
  pathsRef.current = repoPaths;
  const [byRepo, setByRepo] = useState<Map<string, Map<string, PrMark>>>(() => new Map(cache));

  const load = useCallback(async (force: boolean, only?: string[]) => {
    const deferred: string[] = [];
    const stale = (only ?? pathsRef.current).filter((path) => {
      if (inFlight.has(path)) {
        // A turn-ending read must follow an older read, not be dropped behind it:
        // that older answer may predate the agent creating a pull request.
        if (force) deferred.push(path);
        return false;
      }
      return force || Date.now() - (fetchedAt.get(path) ?? 0) >= FRESH_MS;
    });
    if (stale.length === 0 && deferred.length === 0) return;

    const read = async (path: string) => {
      // Several forced callers can queue for one repo. Recheck the slot after
      // each wait so their gh calls never overlap.
      let running = inFlight.get(path);
      while (running) {
        await running;
        running = inFlight.get(path);
      }

      const attempt = (async () => {
        try {
          const answer = marksByBranch(await invoke<PrMark[]>("pr_marks", { cwd: path }));
          cache.set(path, answer);
          fetchedAt.set(path, Date.now());
        } catch {
          // Missing gh, authentication failures, and transient errors must not
          // erase known marks or certify a stale answer as fresh.
        }
      })();
      inFlight.set(path, attempt);
      await attempt;
      if (inFlight.get(path) === attempt) inFlight.delete(path);
    };

    await Promise.all([...stale, ...deferred].map(read));
    setByRepo(new Map(cache));
  }, []);

  useEffect(() => {
    void load(false);
  }, [key, load]);

  // Only visible repos with open PRs need polling: checks and merges can land
  // without a turn. PR-less repos are refreshed when a turn ends.
  const openRepos = repoPaths.filter((path) =>
    [...(byRepo.get(path) ?? EMPTY).values()].some((pr) => pr.state === "OPEN"),
  );
  const openKey = openRepos.join("\n");

  useEffect(() => {
    if (!openKey) return;
    const targets = openKey.split("\n");
    const id = setInterval(() => void load(true, targets), OPEN_POLL_MS);
    return () => clearInterval(id);
  }, [openKey, load]);

  return {
    prFor: useCallback(
      (repoPath: string, branch: string | null): PrMark | undefined =>
        branch ? (byRepo.get(repoPath) ?? EMPTY).get(branch) : undefined,
      [byRepo],
    ),
    refresh: useCallback(() => void load(true), [load]),
  };
}

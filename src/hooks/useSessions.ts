import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { useState, useEffect } from "react";
import { useComposerPrefs, type EffortByModel } from "@/hooks/useComposerPrefs";
import { AgentEvent, ApprovalPolicy, BranchList, Effort, Model, ModelId, Project, SessionIndexItem, SessionSnapshot, SessionTitleEvent } from "../types/events";

// Only for a session indexed before the model was recorded, which reads back as
// "unknown". Everything else seeds from the user's stored prefs.
const DEFAULT_MODEL: ModelId = "haiku";
const DEFAULT_EFFORT: Effort = "high";

export type StreamingBlock = {
    index: number,
    type: "text" | "thinking" | "tool_use" | null
    text: string,
}

export function useSessions() {

    // The sticky defaults. Live state below seeds from these and writes back on
    // every user-initiated change; restoring a session writes live state only.
    const [prefs, setPrefs] = useComposerPrefs();

    const [sessions, setSessions] = useState<SessionSnapshot[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
    // sessionId → the one in-flight block (CLI streams start→deltas→stop serially).
    const [streamingContentBlock, setStreamingContentBlock] = useState<Record<string, StreamingBlock | null>>({});
    const [sessionIndexItems, setSessionIndexItems] = useState<SessionIndexItem[]>([]);
    // Which side of the archived split the sidebar is showing. Not persisted:
    // archived is the exception view, so every launch starts on the active list.
    const [showArchived, setShowArchived] = useState(false);
    const [models, setModels] = useState<Model[]>([]);
    // Seeded once from prefs, then free to diverge: selecting a session overwrites
    // these with what that session was started with, which must not feed back.
    const [modelId, setModelId] = useState<ModelId>(() => prefs.modelId);
    const [effortByModel, setEffortByModel] = useState<EffortByModel>(() => prefs.effortByModel);
    const [permissionMode, setPermissionModeState] = useState<ApprovalPolicy>(() => prefs.permissionMode);
    const [projects, setProjects] = useState<Project[]>([]);
    const [projectPath, setProjectPath] = useState<string | null>(null);
    // Derived from the selected project, not a preference — refetched on switch
    // and never persisted.
    const [branches, setBranches] = useState<BranchList | null>(null);
    const [branch, setBranch] = useState<string | null>(null);
    // The branch a switch is waiting on the user to confirm, because the tree
    // has uncommitted changes. Null when nothing is pending.
    const [pendingBranch, setPendingBranch] = useState<string | null>(null);
    const [useWorktree, setUseWorktreeState] = useState(() => prefs.useWorktree);
    // Per-session, not global: sessions run concurrently and all of their events
    // arrive on the same channel, so a single flag would clear on another's turn.
    const [busyBySession, setBusyBySession] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);

// What actually gets sent for the current model: its remembered pick, else its
// own default, and null for a model that takes no effort flag at all.
const model = models.find((m) => m.id === modelId) ?? null;
const effort: Effort | null = model
  ? model.efforts.length
    ? effortByModel[modelId] ?? model.defaultEffort ?? DEFAULT_EFFORT
    : null
  : effortByModel[modelId] ?? null;

// A null effort means "just switch to this model" — it must leave the model's
// remembered pick alone, or coming back to Sonnet would lose the Extra High set
// on it earlier. Only an explicit level writes to the map.
const handleModelChange = (nextModelId: ModelId, nextEffort: Effort | null) => {
  setModelId(nextModelId);
  if (nextEffort) {
    const next = { ...effortByModel, [nextModelId]: nextEffort };
    setEffortByModel(next);
    setPrefs({ modelId: nextModelId, effortByModel: next });
    return;
  }
  setPrefs({ modelId: nextModelId });
};

// Wrapped rather than exported raw: picking a mode is a preference, and the
// hotkey in App.tsx goes through here too.
const setPermissionMode = (mode: ApprovalPolicy) => {
  setPermissionModeState(mode);
  setPrefs({ permissionMode: mode });
};

// Sticky, unlike before. Someone who works in worktrees works in worktrees; the
// old reset-to-off made them re-toggle it for every single task.
//
// Resolved against the rendered value rather than inside the state updater: React
// may run an updater twice, and writing the preference from in there would fire
// the side effect twice with it.
const setUseWorktree = (next: boolean | ((prev: boolean) => boolean)) => {
  const resolved = typeof next === "function" ? next(useWorktree) : next;
  setUseWorktreeState(resolved);
  setPrefs({ useWorktree: resolved });
};

// Attaching a known project just selects it, so this doubles as "switch to one
// I already have" without the picker growing duplicates.
const handleAttachProject = async () => {
  const picked = await open({ directory: true, multiple: false });
  if (typeof picked !== "string") return;

  try {
    // Returns the list already sorted, so the attached project is at the front.
    setProjects(await invoke<Project[]>("add_project", { path: picked }));
    setProjectPath(picked);
  } catch (e) {
    setError(String(e));
  }
};

const handleSelectProject = (path: string) => {
  setProjectPath(path);
  // Fire and forget: losing the remembered pick costs one dropdown next launch.
  void invoke("set_last_selected_project", { path }).catch(() => {});
};

// Checks the branch out for real, so the picker is the only thing that moves the
// working tree — by send time the repo is already where the session expects it.
const runCheckout = async (target: string, stash: boolean) => {
  if (!projectPath) return;

  try {
    const list = await invoke<BranchList>("checkout_branch", {
      cwd: projectPath,
      branch: target,
      stash,
    });
    setBranches(list);
    setBranch(list.current);
  } catch (e) {
    // Git refuses rather than clobbering, so the tree is untouched and the
    // message names the files in the way.
    setError(String(e));
  } finally {
    setPendingBranch(null);
  }
};

// A clean tree switches silently; a dirty one routes through the dialog, whose
// buttons call back into `runCheckout` with the user's choice.
//
// The dirty count is re-read here rather than taken from `branches`: that was
// fetched when the project was selected, and the user has been editing files
// since. A stale zero silently skips the dialog and moves their work.
const handleSelectBranch = async (target: string) => {
  if (!projectPath || target === branches?.current) return;

  let list: BranchList;
  try {
    list = await invoke<BranchList>("list_branches", { cwd: projectPath });
    setBranches(list);
  } catch (e) {
    setError(String(e));
    return;
  }

  if (list.dirty > 0) {
    setPendingBranch(target);
    return;
  }

  void runCheckout(target, false);
};

const selectedSession = selectedSessionId ? sessions.find((s) => s.sessionId === selectedSessionId) ?? null : null;

// Dedupes against the queued array, not the render snapshot: two fast clicks
// both miss an `existing` check made before their `await`, and would otherwise
// each append the same session.
const upsertSession = (snapshot: SessionSnapshot) =>
  setSessions((prev) =>
    prev.some((s) => s.sessionId === snapshot.sessionId)
      ? prev.map((s) => (s.sessionId === snapshot.sessionId ? snapshot : s))
      : [...prev, snapshot],
  );

const handleSendMsg = async (
  message: string,
) => {

  let sessionId = selectedSessionId;
  const isNewSession = !sessionId;

  const existing = sessionId ? sessions.find((s) => s.sessionId === sessionId) : undefined;
  // The backend reads the recorded cwd on resume, so this only has to be right
  // for a new session.
  const cwd = isNewSession ? projectPath : existing?.cwd ?? projectPath;

  if (!cwd) {
    setError("Attach a project first.");
    return;
  }

  if (!sessionId) {
    sessionId = crypto.randomUUID();
    setSelectedSessionId(sessionId);
  }

  setError(null);
  setBusyBySession((prev) => ({ ...prev, [sessionId]: true }));

  try {
    const snapshot = await invoke<SessionSnapshot | null>("send_msg", {
      sessionId,
      prompt: message,
      harness: "claude_code",
      model: modelId,
      effort,
      permissionMode,
      cwd,
      // Recorded, not acted on — the picker already checked it out. Null for a
      // worktree session, whose branch the CLI names itself.
      branch: isNewSession && !useWorktree ? branch : null,
      useWorktree: isNewSession && useWorktree,
      worktreeName: null,
      isNewSession,
    });

    // Only a new session yields a snapshot. Built by the backend, so the resolved
    // worktree name and truncated title come from disk rather than a guess here.
    if (snapshot) {
      upsertSession(snapshot);
      // A new session is never archived, so it belongs to the active list only —
      // pushed unconditionally it would show up under the archived filter too.
      if (!showArchived) {
        setSessionIndexItems((prev) => [...prev, snapshot]);
      }
      return;
    }

    // The backend just bumped `modified` and the model on an existing session's
    // index entry; mirror it so the sidebar doesn't need a refetch.
    setSessionIndexItems((prev) =>
      prev.map((i) =>
        i.sessionId === sessionId
          ? { ...i, model: modelId, effort, permissionMode, modified: new Date().toISOString() }
          : i,
      ),
    );
  } catch (e) {
    // A rejected invoke means the turn never started, so nothing will arrive to
    // clear the flag — release it here rather than leaving the composer stuck.
    setBusyBySession((prev) => ({ ...prev, [sessionId]: false }));
    setError(String(e));
  }
};

// Restores the user's own defaults, not the app's. Selecting a session overwrote
// the live controls with that session's settings, so every field they can change
// has to be put back from prefs here — otherwise the last session clicked in the
// sidebar silently becomes the template for the next new one.
//
// Branch is the exception: it seeds from whatever the repo is checked out to,
// since the picker is the only thing that moves the tree and a remembered name
// would either be a lie or an unasked-for checkout.
const handleNewSession = () => {
  setSelectedSessionId(null);
  setModelId(prefs.modelId);
  setEffortByModel(prefs.effortByModel);
  setPermissionModeState(prefs.permissionMode);
  setUseWorktreeState(prefs.useWorktree);
  setBranch(branches?.current ?? null);
};

const handleSelectSessionIndexItem = async (sessionId: string) => {
  setSelectedSessionId(sessionId);

  // Restores what this session was started with. Every setter here is the raw
  // state setter, never the prefs-writing wrapper: these values are the session's,
  // not the user's choice, and clicking through the sidebar must not rewrite the
  // defaults that `handleNewSession` reads back.
  const indexItem = sessionIndexItems.find((i) => i.sessionId === sessionId);
  if (indexItem) {
    // Sessions indexed before the model was recorded read back as "unknown".
    const restored =
      indexItem.model === "unknown" ? DEFAULT_MODEL : indexItem.model;
    setModelId(restored);
    // The index stores one model/effort pair, so it can only seed that model's
    // entry; the rest of the map falls back to per-model defaults.
    if (indexItem.effort) {
      setEffortByModel((prev) => ({ ...prev, [restored]: indexItem.effort! }));
    }
    setPermissionModeState(indexItem.permissionMode);
  }

  // Project, branch, and the worktree flag aren't restored — the composer hides
  // all three once a session exists, and they'd only mislead the next new chat.

  if (sessions.some((s) => s.sessionId === sessionId)) {
    return;
  }

  try {
    const snapshot = await invoke<SessionSnapshot | null>("get_session_by_id", { sessionId });
    if (snapshot) {
      upsertSession(snapshot);
    }
  } catch (e) {
    setError(String(e));
  }
}



// One call for both flags, so a click writes only the one it owns. The row is
// replaced from what the store returned rather than from the value we sent —
// the index is authoritative, and a failed write must not leave the sidebar
// showing a state the disk doesn't have.
const setSessionFlags = async (
  sessionId: string,
  flags: { archived?: boolean; pinned?: boolean },
) => {
  try {
    const updated = await invoke<SessionIndexItem | null>("set_session_flags", {
      sessionId,
      archived: flags.archived ?? null,
      pinned: flags.pinned ?? null,
    });
    if (!updated) return;
    setSessionIndexItems((prev) =>
      prev.flatMap((i) => {
        if (i.sessionId !== sessionId) return [i];
        // Archiving from the active list — or unarchiving from the archived one —
        // moves the row to the other view, so it leaves this one rather than
        // sitting there contradicting the filter that produced the list.
        return updated.archived === showArchived ? [updated] : [];
      }),
    );
    // The open transcript keeps its own copy of the index fields, and it's what
    // the composer reads `archived` from — left alone, settling the session on
    // screen would swap in the unsettle bar only after a reselect.
    setSessions((prev) =>
      prev.map((s) =>
        s.sessionId === sessionId
          ? { ...s, archived: updated.archived, pinned: updated.pinned }
          : s,
      ),
    );
  } catch (e) {
    setError(String(e));
  }
};

// Refetched on every toggle rather than filtered from one cached list: the two
// views are disjoint, so holding both would mean tracking which of them a flag
// write belongs to.
useEffect(() => {
  invoke<SessionIndexItem[]>("list_session_index_items", { archived: showArchived })
    .then(setSessionIndexItems)
    .catch((e) => setError(String(e)));
}, [showArchived])

useEffect(() => {
  invoke<Model[]>("list_models").then(setModels);
}, [])

useEffect(() => {
  invoke<Project[]>("list_projects")
    .then((list) => {
      setProjects(list);
      // Sorted most-recently-selected first, so the front of the list *is* the
      // project to reopen — no separate pointer to keep in step.
      setProjectPath(list[0]?.path ?? null);
    })
    // Without this a failed read leaves the picker silently empty, and the
    // reason only reaches the console.
    .catch((e) => setError(String(e)));
}, [])

// Refetched per project rather than cached: branches change outside the app.
// The guard matters because switching projects quickly would otherwise let a
// slower repo's response land on top of the faster one's.
useEffect(() => {
  if (!projectPath) {
    setBranches(null);
    setBranch(null);
    return;
  }

  let cancelled = false;

  invoke<BranchList>("list_branches", { cwd: projectPath })
    .then((list) => {
      if (cancelled) return;
      setBranches(list);
      setBranch(list.current);
    })
    .catch((e) => {
      if (cancelled) return;
      // Cleared rather than left stale: the picker would otherwise offer the
      // previous project's branches for this one.
      setBranches(null);
      setBranch(null);
      setError(String(e));
    });

  return () => {
    cancelled = true;
  };
}, [projectPath])

useEffect(() => {
  const setupListener = async () => {
    const unlisten = await listen<AgentEvent>("agent_event", (event) => {
      // console.log(event);

      const agentEvent = event.payload;

        if (agentEvent.payload.type != "delta") {
            setSessions((prev) =>
            prev.map((s) =>
                s.sessionId === agentEvent.sessionId
                ? { ...s, events: [...s.events, agentEvent] }
                : s,
            ),
            );

            // The committed event supersedes its preview, and it arrives one
            // line *before* `block_stop` — so waiting for the stop leaves both
            // on screen for a frame, the preview shoved down by the event that
            // just replaced it. Retiring the preview here puts both writes in
            // one listener call, which React batches into a single render.
            const streamingBlockRef =
              (agentEvent.payload.type === "assistant_text" ||
                agentEvent.payload.type === "reasoning") &&
              agentEvent.payload.block;

            if (streamingBlockRef) {
              setStreamingContentBlock((prev) => {
                const cur = prev[agentEvent.sessionId];
                // Index alone: the CLI runs one block at a time, but a stale
                // preview from an earlier message would share indices.
                if (!cur || cur.index !== streamingBlockRef.index) return prev;
                return { ...prev, [agentEvent.sessionId]: null };
              });
            }

            // The only signals that a turn is over. `turn_completed` fires once per
            // turn rather than per session, so this releases exactly the session
            // whose turn ended and leaves any other running one alone.
            const done =
              agentEvent.payload.type === "turn_completed" ||
              (agentEvent.payload.type === "error" && agentEvent.payload.fatal);

            if (done) {
              setBusyBySession((prev) => ({ ...prev, [agentEvent.sessionId]: false }));
            }

            if (agentEvent.payload.type === "error") {
              setError(agentEvent.payload.message);
            }
        } else {
            const payload = agentEvent.payload;

            const sessionId = agentEvent.sessionId;

            if (payload.delta == "block_start") {
                setStreamingContentBlock((prev) => ({
                  ...prev,
                  [sessionId]: { index: payload.block.index, text: "", type: null },
                }));
            } else if (payload.delta == "text_delta") {
                setStreamingContentBlock((prev) => {
                  const cur = prev[sessionId];
                  if (!cur || cur.index !== payload.block.index) return prev;
                  return {
                    ...prev,
                    [sessionId]: { ...cur, type: "text", text: cur.text + payload.text },
                  };
                });
            } else if (payload.delta == "input_delta") {
                setStreamingContentBlock((prev) => {
                  const cur = prev[sessionId];
                  if (!cur || cur.index !== payload.block.index) return prev;
                  return {
                    ...prev,
                    [sessionId]: {
                      ...cur,
                      type: "tool_use",
                      text: cur.text + payload.partialJson,
                    },
                  };
                });
            } else if (payload.delta == "block_stop") {
                setStreamingContentBlock((prev) => ({ ...prev, [sessionId]: null }));
            } else {
                setStreamingContentBlock((prev) => ({ ...prev, [sessionId]: null }));
            }
        }

    });
    return unlisten;
  };

  const listenerPromise = setupListener();

  return () => {
    listenerPromise.then((unlisten) => unlisten());
  };
}, []);

// The backend generates a title a few seconds after a session starts and writes
// it to the index itself, so this only mirrors what's already on disk. Its own
// listener rather than a branch in `agent_event`: nothing here came from the
// agent, and it must not land in the session's event list.
useEffect(() => {
  const listenerPromise = listen<SessionTitleEvent>("session_title", (event) => {
    const { sessionId, title } = event.payload;

    setSessionIndexItems((prev) =>
      prev.map((i) => (i.sessionId === sessionId ? { ...i, title } : i)),
    );
    setSessions((prev) =>
      prev.map((s) => (s.sessionId === sessionId ? { ...s, title } : s)),
    );
  });

  return () => {
    listenerPromise.then((unlisten) => unlisten());
  };
}, []);

// A brand-new session has no id until its first send, so nothing can be in flight.
const busy = selectedSessionId ? busyBySession[selectedSessionId] ?? false : false;

return {sessions, selectedSessionId, selectedSession, streamingContentBlock, sessionIndexItems, showArchived, setShowArchived, models, modelId, effort, permissionMode, projects, projectPath, branches, branch, useWorktree, busy, busyBySession, error, setError, handleModelChange, setPermissionMode, handleAttachProject, handleSelectProject, handleSelectBranch, pendingBranch, setPendingBranch, runCheckout, setUseWorktree, handleSendMsg, handleSelectSessionIndexItem, handleNewSession, setSessionFlags};

}
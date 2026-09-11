import { useCallback, useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

import type { Attachment } from "@/types/events";

/// What is pinned to the composer but not yet sent, keyed by the session it was
/// attached to. `null` is the new task's own key, exactly as in `useDraft` — and
/// for the same reason: `AppShell` moves the footer when it is centered, so
/// crossing from the empty state into a session unmounts `ChatInput` and mounts
/// a fresh one. Anything held in component state would be lost on that switch.
///
/// Module-level also because there are two writers in two places. The `+` button
/// lives in `ComposerToolbar`, which is passed to `ChatInput` as an opaque
/// `ReactNode`, so the two cannot pass props to each other — they share this
/// instead, and neither has to know the other exists.
///
/// Not persisted: an attachment is part of a sentence you were in the middle of,
/// and the file it points at may not survive a restart either.
const bySession = new Map<string | null, Attachment[]>();
const listeners = new Set<() => void>();

// One frozen array for every empty key. `useSyncExternalStore` re-renders on any
// snapshot that isn't reference-equal to the last, so minting `[]` per read
// would loop forever.
const EMPTY: Attachment[] = [];

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(sessionId: string | null, next: Attachment[]) {
  if (next.length) bySession.set(sessionId, next);
  else bySession.delete(sessionId);
  emit();
}

function mergeAttachments(sessionId: string | null, added: Attachment[]) {
  if (!added.length) return;

  // Re-read rather than closing over an earlier snapshot: the picker, paste, and
  // drop reads are all awaited, and another attachment landing in between must
  // not be dropped.
  const now = bySession.get(sessionId) ?? EMPTY;
  write(sessionId, [...now, ...added.filter((a) => !now.some((b) => b.path === a.path))]);
}

/// Describes each path in the backend and pins the ones that can be attached.
/// Deduped on path, so dropping the same screenshot twice pins one — the path is
/// the identity, and a second copy of one file says nothing the first didn't.
/// Returns whether at least one path was readable, which lets paste restore
/// path-looking text when it was not actually a file.
export async function addAttachmentPaths(
  sessionId: string | null,
  paths: string[],
): Promise<boolean> {
  const current = bySession.get(sessionId) ?? EMPTY;
  const fresh = paths.filter((path) => !current.some((a) => a.path === path));
  if (!fresh.length) return true;

  const added = await invoke<Attachment[]>("read_attachments", { paths: fresh });
  mergeAttachments(sessionId, added);
  return added.length > 0;
}

/// Saves clipboard pixels through Rust so they enter the same path-based
/// attachment pipeline as picker and drag/drop files.
export async function addPastedImage(
  sessionId: string | null,
  bytes: Uint8Array,
  mimeType: string,
) {
  const attachment = await invoke<Attachment>("save_pasted_image", {
    bytes: Array.from(bytes),
    mimeType,
  });
  mergeAttachments(sessionId, [attachment]);
}

/// Saves a clipboard file when the webview exposes its bytes but not its source
/// path. Rust gives it a temporary path so it can use the same send pipeline as
/// files copied from a file manager.
export async function addPastedFile(sessionId: string | null, bytes: Uint8Array, name: string) {
  const attachment = await invoke<Attachment>("save_pasted_file", {
    bytes: Array.from(bytes),
    name,
  });
  mergeAttachments(sessionId, [attachment]);
}

/// Opens the system file picker and pins whatever comes back. Resolves to
/// nothing when the user cancels.
export async function pickAttachments(sessionId: string | null) {
  const picked = await open({ multiple: true, title: "Attach files" });
  if (!picked) return;

  await addAttachmentPaths(sessionId, Array.isArray(picked) ? picked : [picked]);
}

export function removeAttachment(sessionId: string | null, path: string) {
  const current = bySession.get(sessionId);
  if (!current) return;

  write(
    sessionId,
    current.filter((a) => a.path !== path),
  );
}

export function clearAttachments(sessionId: string | null) {
  if (!bySession.has(sessionId)) return;
  write(sessionId, EMPTY);
}

/// One session's pending attachments. Read-only — every mutation is a
/// module-level function above, so a caller that only writes (the toolbar's `+`)
/// takes no subscription and re-renders for nothing.
export function useAttachments(sessionId: string | null): Attachment[] {
  const getSnapshot = useCallback(() => bySession.get(sessionId) ?? EMPTY, [sessionId]);

  return useSyncExternalStore(subscribe, getSnapshot);
}

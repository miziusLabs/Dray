import type { WorktreeDisposition } from "@/types/events";

/// Names what deleting a worktree would take, in the order it would be missed.
///
/// `null` for a tree holding nothing — which is also the signal that no warning
/// is owed. A settled session's empty worktree is the case this whole feature
/// exists for, and copy that hedged about it would make the common answer look
/// like the risky one.
///
/// Shared by the notice and the dialog so the two routes to the same deletion
/// cannot describe it differently. Commits are named "on no other branch"
/// rather than "unpushed": the count is of commits no other ref holds, so a
/// pushed *or* locally-merged branch reads as costing nothing.
export function worktreeCost({
  changedFiles,
  unpushedCommits,
}: WorktreeDisposition): string | null {
  const parts: string[] = [];

  if (changedFiles > 0) {
    parts.push(`${changedFiles} uncommitted ${changedFiles === 1 ? "file" : "files"}`);
  }
  if (unpushedCommits > 0) {
    parts.push(
      `${unpushedCommits} ${unpushedCommits === 1 ? "commit" : "commits"} on no other branch`,
    );
  }

  return parts.length > 0 ? parts.join(" and ") : null;
}

/// The line under "Delete worktree?" on the notice.
///
/// Both halves are load-bearing and they answer the two questions the card
/// raises at once. What survives is stated every time, in the same words,
/// because "delete" next to a conversation the reader wants to keep is the
/// fear that makes them ignore the card. What is lost is stated only when
/// there is something to lose, and named rather than counted vaguely — the
/// reader is deciding in fifteen seconds and "some changes" is not a decision
/// they can make.
export function worktreeNoticeDetail(disposition: WorktreeDisposition): string {
  const cost = worktreeCost(disposition);

  return cost
    ? `${cost} would go with it. The chat stays either way.`
    : `Nothing unsaved is in it, and the chat stays either way.`;
}

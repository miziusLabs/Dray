import { describe, expect, it } from "vitest";

import { worktreeCost, worktreeNoticeDetail } from "@/lib/worktree";

const tree = (changedFiles: number, unpushedCommits: number) => ({
  exists: true,
  changedFiles,
  unpushedCommits,
  lockedBy: null,
});

describe("worktreeCost", () => {
  it("says nothing about a tree holding nothing", () => {
    expect(worktreeCost(tree(0, 0))).toBeNull();
  });

  it("counts each kind on its own and joins them", () => {
    expect(worktreeCost(tree(2, 0))).toBe("2 uncommitted files");
    expect(worktreeCost(tree(0, 3))).toBe("3 commits on no other branch");
    expect(worktreeCost(tree(2, 3))).toBe(
      "2 uncommitted files and 3 commits on no other branch",
    );
  });

  it("reads as English at one of each", () => {
    expect(worktreeCost(tree(1, 1))).toBe("1 uncommitted file and 1 commit on no other branch");
  });
});

describe("worktreeNoticeDetail", () => {
  // The promise the card exists to make: settling deletes a directory, and the
  // conversation is the thing the reader is most afraid of losing. Dropping it
  // from either branch is what would make the card ignorable.
  it("promises the chat survives whether or not anything is lost", () => {
    expect(worktreeNoticeDetail(tree(0, 0))).toContain("the chat stays");
    expect(worktreeNoticeDetail(tree(1, 0))).toContain("The chat stays");
  });

  it("names what goes only when something would", () => {
    expect(worktreeNoticeDetail(tree(0, 0))).toContain("Nothing unsaved");
    expect(worktreeNoticeDetail(tree(2, 1))).toContain(
      "2 uncommitted files and 1 commit on no other branch",
    );
  });
});

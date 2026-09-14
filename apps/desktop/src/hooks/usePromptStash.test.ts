import { describe, expect, it } from "vitest";

import {
  addStashedPrompt,
  removeStashedPrompt,
  stashedPromptsForProject,
  type StashedPrompt,
} from "./usePromptStash";

const prompt = (
  id: string,
  text: string,
  projectPath: string | null = null,
  attachmentPaths: string[] = [],
): StashedPrompt => ({
  id,
  text,
  projectPath,
  attachmentPaths,
});

describe("prompt stash", () => {
  it("puts newly stashed prompts first without changing their text", () => {
    const existing = [prompt("old", "older prompt")];

    expect(addStashedPrompt(existing, "  keep this spacing  ", "/repo", "new")).toEqual([
      prompt("new", "  keep this spacing  ", "/repo"),
      existing[0],
    ]);
  });

  it("preserves attached paths when adding a prompt", () => {
    expect(addStashedPrompt([], "inspect this", "/repo", "new", ["/repo/image.png"])).toEqual([
      prompt("new", "inspect this", "/repo", ["/repo/image.png"]),
    ]);
  });

  it("removes only the restored prompt", () => {
    const prompts = [prompt("new", "new prompt"), prompt("old", "old prompt")];

    expect(removeStashedPrompt(prompts, "new")).toEqual([prompt("old", "old prompt")]);
    expect(removeStashedPrompt(prompts, "missing")).toEqual(prompts);
  });

  it("shows only prompts stashed in the selected project", () => {
    const prompts = [
      prompt("other", "other project", "/other"),
      prompt("current", "current project", "/repo"),
      { id: "legacy", text: "legacy prompt" } as StashedPrompt,
    ];

    expect(stashedPromptsForProject(prompts, "/repo")).toEqual([
      prompt("current", "current project", "/repo"),
    ]);
    expect(stashedPromptsForProject(prompts, null)).toEqual([]);
  });
});

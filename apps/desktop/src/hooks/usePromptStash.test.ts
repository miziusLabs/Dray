import { describe, expect, it } from "vitest";

import { addStashedPrompt, removeStashedPrompt, type StashedPrompt } from "./usePromptStash";

const prompt = (id: string, text: string): StashedPrompt => ({ id, text });

describe("prompt stash", () => {
  it("puts newly stashed prompts first without changing their text", () => {
    const existing = [prompt("old", "older prompt")];

    expect(addStashedPrompt(existing, "  keep this spacing  ", "new")).toEqual([
      prompt("new", "  keep this spacing  "),
      existing[0],
    ]);
  });

  it("removes only the restored prompt", () => {
    const prompts = [prompt("new", "new prompt"), prompt("old", "old prompt")];

    expect(removeStashedPrompt(prompts, "new")).toEqual([prompt("old", "old prompt")]);
    expect(removeStashedPrompt(prompts, "missing")).toEqual(prompts);
  });
});

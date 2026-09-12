import { useCallback } from "react";

import { useLocalStorage } from "@/hooks/useLocalStorage";

export type StashedPrompt = {
  id: string;
  text: string;
  projectPath: string | null;
};

const STASH_KEY = "ade.promptStash";

export function addStashedPrompt(
  prompts: StashedPrompt[],
  text: string,
  projectPath: string | null,
  id: string,
): StashedPrompt[] {
  return [{ id, text, projectPath }, ...prompts];
}

export function removeStashedPrompt(
  prompts: StashedPrompt[],
  id: string,
): StashedPrompt[] {
  return prompts.filter((prompt) => prompt.id !== id);
}

export function stashedPromptsForProject(
  prompts: StashedPrompt[],
  projectPath: string | null,
): StashedPrompt[] {
  return prompts.filter((prompt) => prompt.projectPath === projectPath);
}

function newPromptId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/// Prompts saved from the New Task composer. Unlike a draft, a stash is
/// intentional and should survive relaunches until the user restores it.
export function usePromptStash() {
  const [prompts, setPrompts] = useLocalStorage<StashedPrompt[]>(STASH_KEY, []);

  const stashPrompt = useCallback(
    (text: string, projectPath: string | null) => {
      if (!text.trim()) return;
      const id = newPromptId();
      setPrompts((current) => addStashedPrompt(current, text, projectPath, id));
    },
    [setPrompts],
  );

  const removePrompt = useCallback(
    (id: string) => setPrompts((current) => removeStashedPrompt(current, id)),
    [setPrompts],
  );

  return { prompts, stashPrompt, removePrompt };
}

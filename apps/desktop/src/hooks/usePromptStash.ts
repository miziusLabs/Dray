import { useCallback } from "react";

import { useLocalStorage } from "@/hooks/useLocalStorage";

export type StashedPrompt = {
  id: string;
  text: string;
  projectPath: string | null;
  attachmentPaths: string[];
};

const STASH_KEY = "ade.promptStash";

export function addStashedPrompt(
  prompts: StashedPrompt[],
  text: string,
  projectPath: string | null,
  id: string,
  attachmentPaths: string[] = [],
): StashedPrompt[] {
  return [{ id, text, projectPath, attachmentPaths }, ...prompts];
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

/// Prompts saved from a composer. Unlike a draft, a stash is intentional,
/// app-wide, and should survive relaunches until the user restores it. Paths
/// are persisted rather than previews so images can be re-read by the normal
/// attachment pipeline when restored.
export function usePromptStash() {
  const [prompts, setPrompts] = useLocalStorage<StashedPrompt[]>(STASH_KEY, []);

  const stashPrompt = useCallback(
    (text: string, projectPath: string | null, attachmentPaths: string[] = []) => {
      if (!text.trim() && !attachmentPaths.length) return;
      const id = newPromptId();
      setPrompts((current) => addStashedPrompt(current, text, projectPath, id, attachmentPaths));
    },
    [setPrompts],
  );

  const removePrompt = useCallback(
    (id: string) => setPrompts((current) => removeStashedPrompt(current, id)),
    [setPrompts],
  );

  return { prompts, stashPrompt, removePrompt };
}

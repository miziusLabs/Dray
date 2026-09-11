import { Bookmark } from "lucide-react";

import PickerMenu from "@/components/composer/PickerMenu";
import type { StashedPrompt } from "@/hooks/usePromptStash";

/// The saved-prompt picker. The full prompt stays in the stash item; rows use a
/// single-line preview so even a multi-line prompt remains one predictable row.
export default function PromptStashMenu({
  prompts,
  activeIndex,
  onPick,
  onHover,
  placement = "below",
}: {
  prompts: StashedPrompt[];
  activeIndex: number;
  onPick: (prompt: StashedPrompt) => void;
  onHover: (index: number) => void;
  placement?: "above" | "below";
}) {
  return (
    <PickerMenu
      groups={[{ label: null, items: prompts }]}
      label="Stashed prompts"
      keyOf={(prompt) => prompt.id}
      activeIndex={activeIndex}
      onPick={onPick}
      onHover={onHover}
      placement={placement}
      surface="composer"
      renderItem={(prompt) => (
        <>
          <Bookmark className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate" title={prompt.text}>
            {prompt.text.replace(/\s+/g, " ")}
          </span>
        </>
      )}
    />
  );
}

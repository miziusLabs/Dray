import { useCallback } from "react";

import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Effort, Model, ModelId, AgentModel } from "@/types/events";

const SEED: TitlePrefs = {
  modelId: "dray",
  agentModel: null,
  effort: "off",
};

export type TitlePrefs = {
  modelId: ModelId;
  agentModel: AgentModel | null;
  effort: Effort;
};

/// The model and reasoning used for the background title request. This is
/// separate from composer preferences: changing the model for a conversation
/// must not silently change the inexpensive cosmetic request that names it.
export function useTitlePrefs() {
  const [prefs, setPrefs] = useLocalStorage<TitlePrefs>("ade.titlePrefs", SEED);

  const merged: TitlePrefs = {
    ...SEED,
    ...prefs,
    modelId: "dray",
  };

  const setTitlePrefs = useCallback(
    (modelId: ModelId, effort: Effort, agentModel: AgentModel | null) => {
      setPrefs({ modelId, effort, agentModel });
    },
    [setPrefs],
  );

  return [merged, setTitlePrefs] as const;
}

/// Title generation uses the same account-supported model choices.
export function titleModels(models: Model[]): Model[] { return models; }

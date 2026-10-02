import { useCallback } from "react";

import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Effort, Model, ModelId, AgentModel } from "@/types/events";

const DEFAULT_TITLE_MODEL: AgentModel = {
  provider: "openai",
  id: "gpt-6-luna",
};
const DEFAULT_TITLE_EFFORT: Effort = "low";

const SEED: TitlePrefs = {
  modelId: "dray",
  agentModel: DEFAULT_TITLE_MODEL,
  effort: DEFAULT_TITLE_EFFORT,
};

export type TitlePrefs = {
  modelId: ModelId;
  agentModel: AgentModel | null;
  effort: Effort;
};

export function mergeTitlePrefs(prefs: Partial<TitlePrefs>): TitlePrefs {
  const hasSelectedModel = prefs.agentModel != null;
  return {
    ...SEED,
    ...prefs,
    modelId: "dray",
    // Older builds stored a null model and `off` as their default. Treat that
    // pair as unset so existing installs move to Luna (low) as well.
    agentModel: prefs.agentModel ?? DEFAULT_TITLE_MODEL,
    effort: hasSelectedModel ? prefs.effort ?? DEFAULT_TITLE_EFFORT : DEFAULT_TITLE_EFFORT,
  };
}

export function titleDefaultEffort(model: Model | undefined): Effort {
  if (
    model?.agentModel?.provider === DEFAULT_TITLE_MODEL.provider &&
    model.agentModel.id === DEFAULT_TITLE_MODEL.id &&
    model.efforts.includes(DEFAULT_TITLE_EFFORT)
  ) {
    return DEFAULT_TITLE_EFFORT;
  }
  return model?.defaultEffort ?? model?.efforts[0] ?? "off";
}

/// The model and reasoning used for the background title request. This is
/// separate from composer preferences: changing the model for a conversation
/// must not silently change the inexpensive cosmetic request that names it.
export function useTitlePrefs() {
  const [prefs, setPrefs] = useLocalStorage<TitlePrefs>("ade.titlePrefs", SEED);
  const merged = mergeTitlePrefs(prefs);

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

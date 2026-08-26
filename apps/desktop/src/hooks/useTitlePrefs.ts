import { useCallback } from "react";

import { useLocalStorage } from "@/hooks/useLocalStorage";
import type { Effort, Model, ModelId, PiModel } from "@/types/events";

export const TITLE_FALLBACK_PI_MODEL: PiModel = {
  provider: "openai-codex",
  id: "gpt-5.6-luna",
};

const SEED: TitlePrefs = {
  modelId: "pi",
  piModel: TITLE_FALLBACK_PI_MODEL,
  effort: "off",
};

export type TitlePrefs = {
  modelId: ModelId;
  piModel: PiModel | null;
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
    modelId: "pi",
  };

  const setTitlePrefs = useCallback(
    (modelId: ModelId, effort: Effort, piModel: PiModel | null) => {
      setPrefs({ modelId, effort, piModel });
    },
    [setPrefs],
  );

  return [merged, setTitlePrefs] as const;
}

/// Pi can still list its configured model when its provider catalog is
/// unavailable. Keep the title-specific fallback selectable in that case.
export function titleModels(models: Model[]): Model[] {
  const hasFallback = models.some(
    (model) =>
      model.id === "pi" &&
      model.piModel?.provider === TITLE_FALLBACK_PI_MODEL.provider &&
      model.piModel?.id === TITLE_FALLBACK_PI_MODEL.id,
  );

  if (hasFallback) return models;

  return [
    {
      id: "pi",
      piModel: TITLE_FALLBACK_PI_MODEL,
      label: `${TITLE_FALLBACK_PI_MODEL.provider}/${TITLE_FALLBACK_PI_MODEL.id}`,
      efforts: ["off", "low", "medium", "high", "xhigh", "max"],
      defaultEffort: "off",
    },
    ...models,
  ];
}

import { describe, expect, it } from "vitest";

import { mergeTitlePrefs, titleDefaultEffort } from "./useTitlePrefs";
import type { Model } from "@/types/events";

const luna: Model = {
  id: "dray",
  agentModel: { provider: "openai", id: "gpt-6-luna" },
  label: "GPT-6 Luna",
  efforts: ["low", "medium", "high"],
  defaultEffort: "medium",
};

const astra: Model = {
  ...luna,
  agentModel: { provider: "openai", id: "gpt-6-astra" },
  label: "GPT-6 Astra",
  defaultEffort: "medium",
};

describe("title generation preferences", () => {
  it("defaults new and legacy unset preferences to GPT-6 Luna at low effort", () => {
    expect(mergeTitlePrefs({})).toEqual({
      modelId: "dray",
      agentModel: { provider: "openai", id: "gpt-6-luna" },
      effort: "low",
    });
    expect(
      mergeTitlePrefs({ modelId: "dray", agentModel: null, effort: "off" }),
    ).toEqual({
      modelId: "dray",
      agentModel: { provider: "openai", id: "gpt-6-luna" },
      effort: "low",
    });
  });

  it("keeps an explicitly selected title model and effort", () => {
    expect(
      mergeTitlePrefs({
        modelId: "dray",
        agentModel: astra.agentModel,
        effort: "high",
      }),
    ).toEqual({ modelId: "dray", agentModel: astra.agentModel, effort: "high" });
  });

  it("uses low for Luna but otherwise respects the model catalog default", () => {
    expect(titleDefaultEffort(luna)).toBe("low");
    expect(titleDefaultEffort(astra)).toBe("medium");
  });
});

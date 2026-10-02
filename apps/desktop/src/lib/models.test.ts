import { describe, expect, it } from "vitest";
import { migrateEffortPreferences, modelKey, resolveEffort, selectionKey } from "./models";
import type { Model } from "@/types/events";

const astra: Model = {
  id: "dray",
  agentModel: { provider: "openai", id: "gpt-6-astra" },
  label: "GPT-6 Astra",
  efforts: ["low", "medium", "high", "xhigh", "max"],
  defaultEffort: "low",
};
const luna: Model = {
  ...astra,
  agentModel: { provider: "openai", id: "gpt-6-luna" },
  defaultEffort: "medium",
};

describe("model reasoning preferences", () => {
  it("keeps preferences separate for concrete models within the same harness", () => {
    const preferences = { [modelKey(astra)]: "max" as const };
    expect(selectionKey(astra.id, astra.agentModel)).toBe(modelKey(astra));
    expect(resolveEffort(astra, preferences[modelKey(astra)] ?? null)).toBe("max");
    expect(resolveEffort(luna, preferences[modelKey(luna)] ?? null)).toBe("medium");
  });

  it("rejects unsupported reasoning and uses the catalog default", () => {
    expect(resolveEffort(astra, "none")).toBe("low");
    expect(resolveEffort(astra, "minimal")).toBe("low");
    expect(resolveEffort(astra, "off")).toBe("low");
    expect(resolveEffort({ ...astra, defaultEffort: "off" }, "none")).toBe("low");
    expect(resolveEffort({ ...astra, efforts: [], defaultEffort: null }, "max")).toBeNull();
    expect(resolveEffort(undefined, "max")).toBeNull();
  });

  it("migrates the shared preference only to the selected model", () => {
    const migrated = migrateEffortPreferences({ dray: "high" }, "dray", astra.agentModel);
    expect(migrated).toEqual({ [modelKey(astra)]: "high" });
    expect(resolveEffort(luna, migrated[modelKey(luna)] ?? null)).toBe("medium");
    expect(migrateEffortPreferences({ dray: "high", [modelKey(astra)]: "max" }, "dray", astra.agentModel))
      .toEqual({ [modelKey(astra)]: "max" });
    expect(migrateEffortPreferences({ dray: "high" }, "dray", null)).toEqual({});
  });
});

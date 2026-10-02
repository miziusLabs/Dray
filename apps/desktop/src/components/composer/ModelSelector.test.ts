import { describe, expect, it } from "vitest";

import { modelsForKeys, nextEffort } from "./ModelSelector";
import type { Model } from "@/types/events";

const model: Model = {
  id: "dray",
  agentModel: { provider: "test", id: "model" },
  label: "Model",
  efforts: ["off", "low", "medium", "high", "xhigh", "max"],
  defaultEffort: "high",
};

describe("modelsForKeys", () => {
  const otherModel: Model = {
    ...model,
    agentModel: { provider: "test", id: "other" },
    label: "Other",
  };

  it("shows the full catalog until a subset is configured", () => {
    expect(modelsForKeys([model, otherModel], null)).toEqual([model, otherModel]);
  });

  it("limits cycling to shown models even with previously saved cycle choices", () => {
    const shown = modelsForKeys([model, otherModel], ["dray:test/model"]);
    expect(modelsForKeys(shown, null)).toEqual([model]);
    expect(modelsForKeys(shown, ["dray:test/model", "dray:test/other"])).toEqual([model]);
    expect(modelsForKeys(shown, ["dray:test/other"])).toEqual([]);
    expect(modelsForKeys(modelsForKeys([model, otherModel], []), null)).toEqual([]);
  });

  it("matches explicit selections by stable model key", () => {
    expect(modelsForKeys([model, otherModel], ["dray:test/other"])).toEqual([otherModel]);
    expect(modelsForKeys([model, otherModel], ["dray:test/model"])).toEqual([model]);
  });
});

describe("nextEffort", () => {
  it("preserves the default Medium-through-Max cycle", () => {
    expect(nextEffort(model, "low")).toBe("medium");
    expect(nextEffort(model, "max")).toBe("medium");
  });

  it("cycles only configured levels supported by the model", () => {
    expect(nextEffort(model, "off", ["off", "high", "max"])).toBe("high");
    expect(nextEffort(model, "high", ["off", "high", "max"])).toBe("max");
    expect(nextEffort(model, "max", ["off", "high", "max"])).toBe("off");

    const limited = { ...model, efforts: ["low", "medium", "high"] as Model["efforts"] };
    expect(nextEffort(limited, "high", ["off", "max"])).toBeNull();
  });
});

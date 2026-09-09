import { describe, expect, it } from "vitest";

import { nextEffort } from "./ModelSelector";
import type { Model } from "@/types/events";

const model: Model = {
  id: "pi",
  piModel: { provider: "test", id: "model" },
  label: "Model",
  efforts: ["off", "low", "medium", "high", "xhigh", "max"],
  defaultEffort: "high",
};

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

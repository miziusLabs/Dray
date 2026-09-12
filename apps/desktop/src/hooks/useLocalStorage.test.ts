import { describe, expect, it } from "vitest";

import {
  readStoredValue,
  resolveAndWriteStoredValue,
} from "./useLocalStorage";

type Prompt = { id: string; text: string };

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("local storage updates", () => {
  it("writes functional updates before a React render can happen", () => {
    const storage = memoryStorage();
    const initial: Prompt[] = [];

    const next = resolveAndWriteStoredValue(
      storage,
      "ade.promptStash",
      initial,
      (current) => [{ id: "prompt-1", text: "saved prompt" }, ...current],
    );

    expect(JSON.parse(storage.getItem("ade.promptStash")!)).toEqual(next);
    expect(readStoredValue(storage, "ade.promptStash", [])).toEqual(next);
  });
});

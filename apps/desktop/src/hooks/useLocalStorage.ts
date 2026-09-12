import { useCallback, useRef, useState } from "react";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function getStorage(): StorageLike | undefined {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}

export function readStoredValue<T>(
  storage: StorageLike | undefined,
  key: string,
  initial: T,
): T {
  try {
    const raw = storage?.getItem(key);
    return raw === null || raw === undefined ? initial : (JSON.parse(raw) as T);
  } catch {
    return initial;
  }
}

export function writeStoredValue<T>(
  storage: StorageLike | undefined,
  key: string,
  value: T,
): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal: the preference just won't outlive the session.
  }
}

/// Resolves and writes an update before returning it. Keeping this outside the
/// React state updater is important for intentional saves such as prompt stashes:
/// a native app can be stopped before React gets another render pass.
export function resolveAndWriteStoredValue<T>(
  storage: StorageLike | undefined,
  key: string,
  previous: T,
  next: T | ((prev: T) => T),
): T {
  const resolved = typeof next === "function" ? (next as (prev: T) => T)(previous) : next;
  writeStoredValue(storage, key, resolved);
  return resolved;
}

/// State that survives reload. Reads lazily so a throwing or absent store costs the
/// initial value rather than the render, and writes are best-effort for the same reason.
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => readStoredValue(getStorage(), key, initial));
  // React updater functions run during a later render. Keep the latest value here
  // so functional updates can be resolved and persisted synchronously instead.
  const valueRef = useRef(value);

  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      const resolved = resolveAndWriteStoredValue(getStorage(), key, valueRef.current, next);
      valueRef.current = resolved;
      setValue(resolved);
    },
    [key],
  );

  return [value, set] as const;
}

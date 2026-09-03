const PREFIX = "poolparlay.";

export function storeGet<T>(key: string): T | undefined {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (raw == null) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function storeSet(key: string, value: unknown): void {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    /* private mode / quota */
  }
}

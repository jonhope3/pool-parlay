import { emptyPool, sanitizePool, type Pool } from "./pool";
import { storeGet, storeSet } from "./store";
import { idbGet, idbSet } from "./idb";

const LS_KEY = "groups.v1";

export type SavedGroup = {
  id: string;
  label: string;
  code: string;
  pool: Pool;
  lastUsed: number;
};

export type GroupStore = {
  groups: SavedGroup[];
  activeId: string;
};

function fromUnknown(raw: unknown): GroupStore | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as { groups?: unknown; activeId?: unknown };
  if (!Array.isArray(obj.groups)) return null;
  const groups = obj.groups
    .map((g) => {
      if (!g || typeof g !== "object") return null;
      const x = g as SavedGroup;
      if (typeof x.id !== "string" || typeof x.code !== "string") return null;
      return {
        id: x.id,
        label: String(x.label || "Group").slice(0, 32),
        code: String(x.code).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
        pool: sanitizePool(x.pool),
        lastUsed: Number(x.lastUsed) || Date.now(),
      };
    })
    .filter((g): g is SavedGroup => Boolean(g));
  if (!groups.length) return null;
  const activeId =
    typeof obj.activeId === "string" && groups.some((g) => g.id === obj.activeId)
      ? obj.activeId
      : groups.sort((a, b) => b.lastUsed - a.lastUsed)[0].id;
  return { groups, activeId };
}

export async function loadGroups(): Promise<GroupStore | null> {
  return (
    fromUnknown(await idbGet<GroupStore>("groups")) ||
    fromUnknown(storeGet<GroupStore>(LS_KEY)) ||
    fromUnknown(storeGet<GroupStore>("groups"))
  );
}

export async function saveGroups(store: GroupStore): Promise<void> {
  const payload: GroupStore = {
    activeId: store.activeId,
    groups: store.groups.map((g) => ({
      ...g,
      pool: sanitizePool(g.pool),
      label: g.label.slice(0, 32),
      code: g.code.toUpperCase(),
    })),
  };
  await idbSet("groups", payload);
  storeSet(LS_KEY, payload);
}

export function newGroup(label: string, code: string, id: string): SavedGroup {
  return {
    id,
    label: label.trim().slice(0, 32) || "My group",
    code: code.trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8),
    pool: emptyPool(),
    lastUsed: Date.now(),
  };
}

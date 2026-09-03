export type Votes = Record<string, Record<string, string>>;

export type Pool = {
  id: string;
  sessions: string[];
  votes: Votes;
  names: Record<string, string>;
  updated: number;
};

export function uid(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function cleanName(raw: unknown): string {
  return String(raw ?? "")
    .replace(/[^\p{L}\p{N} ._'-]/gu, "")
    .trim()
    .slice(0, 20);
}

export function emptyPool(): Pool {
  return { id: uid(), sessions: [], votes: {}, names: {}, updated: Date.now() };
}

export function sanitizePool(raw: unknown): Pool {
  if (!raw || typeof raw !== "object") return emptyPool();
  const obj = raw as Record<string, unknown>;
  const sessions = new Set<string>();
  for (const id of (obj.sessions as unknown[]) || []) {
    if (typeof id === "string") sessions.add(id);
  }
  for (const m of (obj.members as unknown[]) || []) {
    const id = typeof m === "string" ? m : (m as { id?: string })?.id;
    if (id) sessions.add(id);
  }
  const votes: Votes = {};
  for (const [gameId, byUser] of Object.entries((obj.votes as Votes) || {})) {
    votes[gameId] = {};
    for (const [sid, abbr] of Object.entries(byUser || {})) {
      if (typeof abbr === "string") {
        votes[gameId][sid] = abbr;
        sessions.add(sid);
      }
    }
  }
  const names: Record<string, string> = {};
  for (const [sid, name] of Object.entries((obj.names as Record<string, string>) || {})) {
    const cleaned = cleanName(name);
    if (cleaned) {
      names[sid] = cleaned;
      sessions.add(sid);
    }
  }
  return {
    id: typeof obj.id === "string" ? obj.id : uid(),
    sessions: [...sessions],
    votes,
    names,
    updated: Number(obj.updated) || Date.now(),
  };
}

export function mergePools(local: Pool, incoming: Pool): Pool {
  const a = sanitizePool(local);
  const b = sanitizePool(incoming);
  if (a.id !== b.id) {
    return b.sessions.length || Object.keys(b.votes).length ? b : a;
  }
  const sessions = new Set([...a.sessions, ...b.sessions]);
  const votes: Votes = { ...b.votes };
  for (const [gameId, byUser] of Object.entries(a.votes)) {
    votes[gameId] = { ...(votes[gameId] || {}), ...byUser };
  }
  return {
    id: a.id,
    sessions: [...sessions],
    votes,
    names: { ...a.names, ...b.names },
    updated: Date.now(),
  };
}

export function applyVote(pool: Pool, sessionId: string, gameId: string, abbr: string): Pool {
  const votes = { ...pool.votes, [gameId]: { ...(pool.votes[gameId] || {}) } };
  if (votes[gameId][sessionId] === abbr) delete votes[gameId][sessionId];
  else votes[gameId][sessionId] = abbr;
  const sessions = pool.sessions.includes(sessionId)
    ? pool.sessions
    : [...pool.sessions, sessionId];
  return { ...pool, votes, sessions, updated: Date.now() };
}

export function setDisplayName(pool: Pool, sessionId: string, name: string): Pool {
  const cleaned = cleanName(name);
  const names = { ...pool.names };
  if (cleaned) names[sessionId] = cleaned;
  else delete names[sessionId];
  const sessions = pool.sessions.includes(sessionId)
    ? pool.sessions
    : [...pool.sessions, sessionId];
  return { ...pool, names, sessions, updated: Date.now() };
}

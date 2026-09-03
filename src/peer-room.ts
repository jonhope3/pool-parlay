import Peer, { type DataConnection, type PeerJSOption } from "peerjs";
import { sanitizePool, mergePools, setDisplayName, type Pool } from "./pool";

const PREFIX = "poolparlay-";
/** One host + this many guests covers ~12 people with headroom. */
export const MAX_GUESTS = 16;
const JOIN_TRIES = 4;
const KEEPALIVE_MS = 8000;

type IceServer = {
  urls: string | string[];
  url?: string | string[];
  username?: string;
  credential?: string;
};

const ICE_SERVERS: IceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
  {
    urls: "turn:openrelay.metered.ca:80",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
  {
    urls: "turn:openrelay.metered.ca:443?transport=tcp",
    username: "openrelayproject",
    credential: "openrelayproject",
  },
].map((s) => ({ ...s, url: s.urls }));

function peerOptions(): PeerJSOption {
  return {
    host: "0.peerjs.com",
    port: 443,
    path: "/",
    secure: true,
    key: "peerjs",
    debug: 0,
    config: {
      iceServers: ICE_SERVERS,
      iceCandidatePoolSize: 0,
    },
  } as PeerJSOption;
}

export function generateRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function normalizeRoomCode(raw: unknown): string {
  return String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 8);
}

export function hostPeerId(code: string): string {
  return PREFIX + code.trim().toUpperCase();
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

type Msg =
  | { type: "hello"; sessionId: string; name?: string }
  | { type: "sync"; pool: Pool }
  | { type: "vote"; sessionId: string; gameId: string; abbr: string }
  | { type: "name"; sessionId: string; name: string }
  | { type: "ping" }
  | { type: "pong" };

export type RoomCallbacks = {
  onStatus: (status: string) => void;
  getPool: () => Pool;
  setPool: (pool: Pool) => void;
  getIdentity: () => { sessionId: string; name: string };
  onHostGone?: () => void;
};

export class PoolRoom {
  peer: Peer | null = null;
  hostConn: DataConnection | null = null;
  guests = new Set<DataConnection>();
  isHost = false;
  roomCode = "";
  private callbacks: RoomCallbacks;
  private gen = 0;
  private keepTimer: ReturnType<typeof setInterval> | null = null;

  constructor(callbacks: RoomCallbacks) {
    this.callbacks = callbacks;
  }

  guestCount(): number {
    return [...this.guests].filter((c) => c.open).length;
  }

  async host(code = generateRoomCode()): Promise<string> {
    this.teardown();
    const gen = ++this.gen;
    this.isHost = true;
    this.roomCode = code.toUpperCase();
    this.callbacks.onStatus("Opening…");
    this.peer = new Peer(hostPeerId(this.roomCode), peerOptions());
    await waitOpen(this.peer);
    if (gen !== this.gen) return this.roomCode;
    this.peer.on("connection", (conn) => this.attachGuest(conn));
    this.startKeepalive();
    this.callbacks.onStatus(`Live · ${this.guestCount() + 1} here`);
    return this.roomCode;
  }

  async join(code: string): Promise<void> {
    this.teardown();
    const gen = ++this.gen;
    this.isHost = false;
    this.roomCode = code.trim().toUpperCase();
    this.callbacks.onStatus("Connecting…");
    this.peer = new Peer(peerOptions());
    await waitOpen(this.peer);
    if (gen !== this.gen) return;
    const conn = this.peer.connect(hostPeerId(this.roomCode), { reliable: true });
    await waitConn(conn);
    if (gen !== this.gen) return;
    this.hostConn = conn;
    conn.on("data", (raw) => this.onMsg(raw as Msg, conn));
    conn.on("close", () => {
      this.callbacks.onStatus("Host left. Reconnecting");
      this.callbacks.onHostGone?.();
    });
    const me = this.callbacks.getIdentity();
    safeSend(conn, { type: "hello", sessionId: me.sessionId, name: me.name });
    this.startKeepalive();
    this.callbacks.onStatus("Live with group");
  }

  broadcastPool(): void {
    const msg: Msg = { type: "sync", pool: sanitizePool(this.callbacks.getPool()) };
    if (!this.isHost) return;
    for (const g of this.guests) safeSend(g, msg);
    this.callbacks.onStatus(`Live · ${this.guestCount() + 1} here`);
  }

  sendName(sessionId: string, name: string): void {
    if (this.isHost) {
      this.callbacks.setPool(setDisplayName(this.callbacks.getPool(), sessionId, name));
      this.broadcastPool();
      return;
    }
    if (this.hostConn) safeSend(this.hostConn, { type: "name", sessionId, name });
  }

  sendVote(sessionId: string, gameId: string, abbr: string): void {
    const msg: Msg = { type: "vote", sessionId, gameId, abbr };
    if (this.isHost) this.broadcastPool();
    else if (this.hostConn) safeSend(this.hostConn, msg);
  }

  private attachGuest(conn: DataConnection): void {
    conn.on("open", () => {
      if (this.guestCount() >= MAX_GUESTS) {
        conn.close();
        return;
      }
      this.guests.add(conn);
      safeSend(conn, { type: "sync", pool: sanitizePool(this.callbacks.getPool()) });
      this.callbacks.onStatus(`Live · ${this.guestCount() + 1} here`);
    });
    conn.on("data", (raw) => this.onMsg(raw as Msg, conn));
    conn.on("close", () => {
      this.guests.delete(conn);
      this.callbacks.onStatus(`Live · ${this.guestCount() + 1} here`);
    });
  }

  private onMsg(msg: Msg, conn: DataConnection): void {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "ping") {
      safeSend(conn, { type: "pong" });
      return;
    }
    if (msg.type === "pong") return;
    if (msg.type === "hello" && this.isHost) {
      if (msg.sessionId && msg.sessionId !== "join" && msg.name) {
        this.callbacks.setPool(setDisplayName(this.callbacks.getPool(), msg.sessionId, msg.name));
      }
      safeSend(conn, { type: "sync", pool: sanitizePool(this.callbacks.getPool()) });
    }
    if (msg.type === "name" && this.isHost) {
      this.callbacks.setPool(setDisplayName(this.callbacks.getPool(), msg.sessionId, msg.name));
      this.broadcastPool();
    }
    if (msg.type === "sync" && !this.isHost) {
      this.callbacks.setPool(mergePools(this.callbacks.getPool(), sanitizePool(msg.pool)));
    }
    if (msg.type === "vote" && this.isHost) {
      const pool = this.callbacks.getPool();
      const byGame = { ...(pool.votes[msg.gameId] || {}) };
      if (!msg.abbr) delete byGame[msg.sessionId];
      else byGame[msg.sessionId] = msg.abbr;
      const sessions = pool.sessions.includes(msg.sessionId)
        ? pool.sessions
        : [...pool.sessions, msg.sessionId];
      this.callbacks.setPool({
        ...pool,
        votes: { ...pool.votes, [msg.gameId]: byGame },
        sessions,
        updated: Date.now(),
      });
      this.broadcastPool();
    }
  }

  private startKeepalive(): void {
    this.stopKeepalive();
    this.keepTimer = setInterval(() => {
      const ping: Msg = { type: "ping" };
      if (this.isHost) {
        for (const g of [...this.guests]) {
          if (!g.open) this.guests.delete(g);
          else safeSend(g, ping);
        }
      } else if (this.hostConn?.open) safeSend(this.hostConn, ping);
    }, KEEPALIVE_MS);
  }

  private stopKeepalive(): void {
    if (this.keepTimer) clearInterval(this.keepTimer);
    this.keepTimer = null;
  }

  teardown(): void {
    this.gen += 1;
    this.stopKeepalive();
    this.hostConn?.close();
    for (const g of this.guests) g.close();
    this.guests.clear();
    this.hostConn = null;
    this.peer?.destroy();
    this.peer = null;
    this.isHost = false;
    this.roomCode = "";
  }
}

function safeSend(conn: DataConnection, msg: Msg): void {
  try {
    if (conn.open) conn.send(msg);
  } catch {
    /* drop */
  }
}

function waitOpen(peer: Peer): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Signaling timed out")), 18000);
    peer.on("open", () => {
      clearTimeout(t);
      resolve();
    });
    peer.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

function waitConn(conn: DataConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("Could not reach the group")), 18000);
    conn.on("open", () => {
      clearTimeout(t);
      resolve();
    });
    conn.on("error", (err) => {
      clearTimeout(t);
      reject(err);
    });
  });
}

export async function joinWithRetry(room: PoolRoom, code: string): Promise<void> {
  let last: unknown;
  for (let i = 0; i < JOIN_TRIES; i++) {
    try {
      await room.join(code);
      return;
    } catch (err) {
      last = err;
      await sleep(600 * (i + 1));
    }
  }
  throw last instanceof Error ? last : new Error("Could not join");
}

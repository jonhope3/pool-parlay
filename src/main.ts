import "./styles.css";
import { storeGet, storeSet } from "./store";
import { idbGet, idbSet } from "./idb";
import {
  sanitizePool,
  applyVote,
  cleanName,
  emptyPool,
  mergePools,
  setDisplayName,
  uid,
  type Pool,
} from "./pool";
import {
  fetchScoreboard,
  attachOdds,
  fetchBoardLines,
  overlayLines,
  formatAmerican,
  formatSpread,
  spreadFor,
  spreadHeadline,
  americanToDecimal,
  decimalToAmerican,
  moneylineFor,
  isLocked,
  loadNflSnapshot,
  nflSeasonYear,
  parseCalendar,
  scoreboardPollMs,
  teamsOf,
  winnerAbbr,
  type NflEvent,
} from "./nfl";
import { generateRoomCode, joinWithRetry, normalizeRoomCode, PoolRoom, sleep } from "./peer-room";
import { loadGroups, newGroup, saveGroups, type SavedGroup } from "./groups";

const LEGACY_LS = "poolparlay.v2";
const MAX_GROUPS = 24;
const STAKE_PRESETS = [1, 5, 10, 20, 50];

const els = {
  weekRail: document.getElementById("week-rail")!,
  games: document.getElementById("games-list")!,
  banner: document.getElementById("status-banner")!,
  season: document.getElementById("season-label")!,
  parlaySummary: document.getElementById("parlay-summary")!,
  parlayLegs: document.getElementById("parlay-legs")!,
  poolCard: document.getElementById("pool-card")!,
  shareBtn: document.getElementById("share-btn")!,
  rulesGate: document.getElementById("rules-gate")!,
  rulesGo: document.getElementById("rules-go")!,
  rulesName: document.getElementById("rules-name") as HTMLInputElement,
  rulesLede: document.getElementById("rules-lede")!,
  groupPill: document.getElementById("group-pill") as HTMLButtonElement,
  withBar: document.getElementById("with-bar") as HTMLButtonElement,
  withName: document.getElementById("with-name")!,
  groupSheet: document.getElementById("group-sheet")!,
  groupSheetList: document.getElementById("group-sheet-list")!,
  stackBar: document.getElementById("stack-bar")!,
};

const state = {
  tab: "games",
  week: null as number | null,
  seasonYear: null as number | null,
  seasonType: 2,
  weeks: [] as Array<{ week: number; label: string }>,
  events: [] as NflEvent[],
  stake: 10,
  sessionId: "",
  pool: emptyPool(),
  roomStatus: "Just this phone",
  groups: [] as SavedGroup[],
  activeId: "",
  withConfirmed: false,
  pendingPick: null as { gameId: string; abbr: string } | null,
  seenRules: false,
};

const room = new PoolRoom({
  onHostGone: () => {
    const code = activeGroup()?.code;
    if (code) void connectGroup(code);
  },
  onStatus: (status) => {
    state.roomStatus = status;
    renderPool();
  },
  getIdentity: () => ({
    sessionId: state.sessionId,
    name: state.pool.names[state.sessionId] || "",
  }),
  getPool: () => state.pool,
  setPool: (pool) => {
    state.pool = sanitizePool(pool);
    void persist();
    renderGames();
    renderParlay();
    renderPool();
  },
});

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function activeGroup(): SavedGroup | undefined {
  return state.groups.find((g) => g.id === state.activeId);
}

function syncWithUi() {
  const label = activeGroup()?.label || "My group";
  if (els.groupPill) els.groupPill.textContent = label;
  if (els.withName) els.withName.textContent = label;
}

function needsGroupChoice(): boolean {
  return state.groups.length > 1 && !state.withConfirmed;
}

function fillGroupSheet() {
  els.groupSheetList.innerHTML = [...state.groups]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .map((g) => {
      const on = g.id === state.activeId;
      return `<button type="button" class="group-row ${on ? "active" : ""}" data-pick-with="${g.id}">
        ${esc(g.label)}${on ? " · last used" : ""}
        <small>Picks stay in this group</small>
      </button>`;
    })
    .join("");
}

function openGroupSheet() {
  fillGroupSheet();
  els.groupSheet.hidden = false;
}

function closeGroupSheet() {
  els.groupSheet.hidden = true;
}

async function chooseGroup(id: string) {
  state.withConfirmed = true;
  closeGroupSheet();
  if (id !== state.activeId) await switchGroup(id);
  else {
    syncWithUi();
    renderAll();
  }
  const pending = state.pendingPick;
  state.pendingPick = null;
  if (pending) vote(pending.gameId, pending.abbr);
}

function snapshotActive() {
  const g = activeGroup();
  if (!g) return;
  g.pool = sanitizePool(state.pool);
  if (room.roomCode) g.code = room.roomCode;
  g.lastUsed = Date.now();
}

async function persist() {
  snapshotActive();
  storeSet("sessionId", state.sessionId);
  storeSet("username", state.pool.names[state.sessionId] || "");
  storeSet("stake", state.stake);
  storeSet("seenRules", state.seenRules);
  await idbSet("sessionId", state.sessionId);
  await idbSet("username", state.pool.names[state.sessionId] || "");
  await idbSet("stake", state.stake);
  await idbSet("seenRules", state.seenRules);
  if (state.groups.length) await saveGroups({ groups: state.groups, activeId: state.activeId });
}

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function voteCounts(gameId: string) {
  const byUser = state.pool.votes[gameId] || {};
  const counts: Record<string, number> = {};
  for (const abbr of Object.values(byUser)) counts[abbr] = (counts[abbr] || 0) + 1;
  return { counts, byUser };
}

function displayName(sessionId: string): string {
  return state.pool.names[sessionId] || (sessionId === state.sessionId ? "You" : "Guest");
}

function msUntil(iso: string): number {
  return new Date(iso).getTime() - Date.now();
}

function formatCountdown(iso: string): string {
  const ms = msUntil(iso);
  if (ms <= 0) return "Kickoff";
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `${mins}m to kickoff`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h to kickoff`;
  return formatWhen(iso);
}

function money(n: number) {
  const cents = Math.round(n * 100) / 100;
  return cents % 1 === 0 ? `$${cents}` : `$${cents.toFixed(2)}`;
}

function clampStake(raw: unknown): number {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return 10;
  return Math.min(10_000, Math.max(1, n));
}

function setStake(raw: unknown) {
  state.stake = clampStake(raw);
  void persist();
  renderGames();
  renderParlay();
}

function stakeChips() {
  return STAKE_PRESETS.map(
    (s) =>
      `<button type="button" class="stake-chip ${s === state.stake ? "active" : ""}" data-stake="${s}">${money(s)}</button>`,
  ).join("");
}

function consensusFor(event: NflEvent): string | null {
  const picks = Object.values(voteCounts(event.id).byUser);
  if (!picks.length) return null;
  if (new Set(picks).size !== 1) return null;
  return picks[0];
}

function americanOdds(decimal: number) {
  return formatAmerican(decimalToAmerican(decimal));
}

function slipFromAmericans(americans: number[], stake = state.stake) {
  const decimal = americans.reduce((p, a) => p * americanToDecimal(a), 1);
  const payout = Math.round(stake * decimal * 100) / 100;
  return {
    legs: americans.length,
    decimal,
    odds: americans.length ? americanOdds(decimal) : "-",
    payout,
    stake,
  };
}

function setBanner(msg: string, show = true) {
  els.banner.hidden = !show;
  els.banner.textContent = msg || "";
}

function renderWeeks() {
  els.weekRail.innerHTML = state.weeks
    .map(
      (w) =>
        `<button type="button" class="week-chip ${w.week === state.week ? "active" : ""}" data-week="${w.week}">${w.label}</button>`,
    )
    .join("");
  els.weekRail.querySelector(".active")?.scrollIntoView({
    inline: "center",
    block: "nearest",
    behavior: "smooth",
  });
}

function gameCard(event: NflEvent): string {
  const { away, home } = teamsOf(event);
  const st = event.status?.type || {};
  const locked = isLocked(event);
  const myPick = state.pool.votes[event.id]?.[state.sessionId];
  const cons = consensusFor(event);
  const { counts, byUser } = voteCounts(event.id);
  const win = winnerAbbr(event);
  const nVotes = Object.keys(byUser).length;
  const pill =
    st.state === "in"
      ? `<span class="pill live">${st.shortDetail || "Live"}</span>`
      : st.completed
        ? `<span class="pill final">Final</span>`
        : locked
          ? `<span class="pill lock">Locked</span>`
          : `<span>${formatCountdown(event.date)}</span>`;

  const teamBtn = (comp: typeof away) => {
    const abbr = comp.team.abbreviation;
    const selected = myPick === abbr;
    const outcome = win && abbr === win ? "winner" : win && abbr !== win ? "loser" : "";
    const hex = (c?: string) => (c ? (c.startsWith("#") ? c : `#${c}`) : "#123848");
    return `
      <button type="button" class="team-btn ${selected ? "selected" : ""} ${outcome}"
        style="--team:${hex(comp.team.color)};--team-2:${hex(comp.team.alternateColor)}"
        data-game="${event.id}" data-abbr="${abbr}" ${locked ? "disabled" : ""}>
        <img src="${comp.team.logo}" alt="">
        <span class="name">${esc(comp.team.shortDisplayName)}</span>
        ${st.completed || st.state === "in" ? `<span class="score">${comp.score ?? ""}</span>` : `<span class="ml">${esc(formatAmerican(moneylineFor(event, abbr)))}</span>${spreadFor(event, abbr) != null ? `<span class="spread">${esc(formatSpread(spreadFor(event, abbr)!))}</span>` : ""}`}
        <span class="votes">${counts[abbr] || 0} pick${(counts[abbr] || 0) === 1 ? "" : "s"}</span>
      </button>`;
  };

  const voters = Object.keys(byUser).map(displayName).join(", ");
  const consLine = cons
    ? `Parlay pick: <strong>${cons}</strong>${nVotes === 1 && !locked ? " · 1 player (open until kickoff)" : ` · ${esc(voters)}`}`
    : nVotes
      ? `Split: ${nVotes} voted`
      : locked
        ? "No pick"
        : "Tap a team. One vote is enough until kickoff";

  const stackHint = (() => {
    if (locked || !myPick) return "";
    const onSlip = cons === myPick;
    const thisAm = moneylineFor(event, myPick);
    if (onSlip) {
      const { payout, odds, legs } = slipFromAmericans(parlayLegs().map((l) => l.american));
      return `<div class="stack-hint on">On the slip · ${legs} deep · ${money(state.stake)} → <strong>${money(payout)}</strong> <span>${odds}</span></div>`;
    }
    const next = slipFromAmericans([...parlayLegs().map((l) => l.american), thisAm]);
    return `<div class="stack-hint">If the group lands here at ${formatAmerican(thisAm)} · ${next.legs} deep · ${money(state.stake)} → <strong>${money(next.payout)}</strong></div>`;
  })();

  return `
    <article class="game-card">
      <div class="game-meta"><span>${esc(event.shortName || "")}</span>${spreadHeadline(event) ? `<span class="spread-tag">${esc(spreadHeadline(event))}</span>` : ""}<span class="meta-end">${pill}</span></div>
      <div class="matchup">${teamBtn(away)}<div class="vs">@</div>${teamBtn(home)}</div>
      <div class="consensus">${consLine}</div>
      ${stackHint}
    </article>`;
}

function renderGames() {
  els.games.innerHTML = state.events.length
    ? state.events.map(gameCard).join("")
    : `<div class="empty">No games for this week yet.</div>`;
  renderStack();
}

function renderStack() {
  if (!els.stackBar) return;
  const legs = parlayLegs();
  const n = legs.length;
  const missed = legs.some((l) => l.result === "miss");
  const slip = slipFromAmericans(legs.map((l) => l.american));
  const { payout, odds } = slip;
  const chips = legs
    .map((l, i) => {
      const cls = l.result === "hit" ? "hit" : l.result === "miss" ? "miss" : "";
      return `<span class="stack-chip ${cls}" title="${esc(l.team.abbreviation)} ${formatAmerican(l.american)}">${i + 1}</span>`;
    })
    .join("");
  const unit = money(state.stake);
  const pay = missed
    ? `<strong class="bad">${unit} → $0</strong><span>a miss busted the slip</span>`
    : n
      ? `<strong>${unit} → ${money(payout)}</strong><span>${n} stacked · ${odds} from each moneyline</span>`
      : `<strong>${unit} → ${unit}</strong><span>Tap a team. Each pick multiplies its moneyline.</span>`;
  els.stackBar.innerHTML = `
    <div class="stack-track">${chips || `<span class="stack-chip ghost">+</span>`}</div>
    <div class="stack-pay">${pay}</div>
    <div class="stake-row" role="group" aria-label="Slip amount">${stakeChips()}</div>`;
}

function parlayLegs() {
  return state.events
    .map((ev) => {
      const pick = consensusFor(ev);
      if (!pick) return null;
      const win = winnerAbbr(ev);
      const result = win ? (win === pick ? "hit" : "miss") : "pending";
      const { away, home } = teamsOf(ev);
      const team = away.team.abbreviation === pick ? away.team : home.team;
      return { pick, result, team, american: moneylineFor(ev, pick) };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

function renderParlay() {
  const legs = parlayLegs();
  const n = legs.length;
  const missed = legs.some((l) => l.result === "miss");
  const allDone = n > 0 && legs.every((l) => l.result !== "pending");
  const hits = legs.filter((l) => l.result === "hit").length;
  const { payout, odds } = slipFromAmericans(legs.map((l) => l.american));
  els.parlaySummary.innerHTML = `
    <h2>Week ${state.week} parlay</h2>
    <p class="fineprint">Each consensus pick stacks at that team’s moneyline. Missing lines use −110. Entertainment only.</p>
    <div class="stake-row">${stakeChips()}</div>
    <label class="field">Custom amount
      <input id="stake-amount" type="number" min="1" max="10000" step="1" inputmode="numeric" value="${state.stake}">
    </label>
    <div class="stat-grid">
      <div class="stat"><span>Legs stacked</span><b>${n}</b></div>
      <div class="stat"><span>Odds</span><b>${n ? odds : "-"}</b></div>
      <div class="stat"><span>Hits</span><b>${hits}/${n || 0}</b></div>
      <div class="stat"><span>${money(state.stake)} slip</span><b>${
        n === 0 ? "-" : missed ? "$0" : payout && allDone ? money(payout) : `${money(payout)} if it hits`
      }</b></div>
    </div>
    ${!missed && n ? `<p class="fineprint">Payout is your stake times every leg’s decimal price. Change the slip amount anytime.</p>` : ""}`;
  els.parlayLegs.innerHTML = n
    ? legs
        .map((l) => {
          const cls = l.result === "hit" ? "ok" : l.result === "miss" ? "bad" : "";
          const mark = l.result === "hit" ? "Hit" : l.result === "miss" ? "Miss" : "Open";
          return `<div class="leg"><span>${esc(l.team.displayName)} <small>${formatAmerican(l.american)}</small></span><b class="${cls}">${mark}</b></div>`;
        })
        .join("")
    : `<div class="empty">No consensus yet. Get everyone on the same team.</div>`;
}

function renderPool() {
  const chips = state.pool.sessions
    .map((id) => {
      const you = id === state.sessionId;
      return `<span class="chip ${you ? "you" : ""}">${esc(displayName(id))}${you ? " (you)" : ""}</span>`;
    })
    .join("");
  const mine = state.pool.names[state.sessionId] || "";
  const rows = [...state.groups]
    .sort((a, b) => b.lastUsed - a.lastUsed)
    .map((g) => {
      const on = g.id === state.activeId;
      return `<div class="group-item ${on ? "active" : ""}">
        <button type="button" class="group-row" data-switch="${g.id}">
          ${esc(g.label)}${on ? " · now" : ""}
          <small>${on ? "Picks on this screen" : "Tap to switch"}</small>
        </button>
        <button type="button" class="group-del" data-delete="${g.id}" aria-label="Remove ${esc(g.label)}">Remove</button>
      </div>`;
    })
    .join("");
  els.poolCard.innerHTML = `
    <h2>Your groups</h2>
    <p class="fineprint">Saved in this browser only. Make one for family and one for in-laws. Tap to hop. Remove a group to drop it from this phone.</p>
    <div class="group-list">${rows}</div>
    <label class="field">Name this group
      <input id="group-label" value="${esc(activeGroup()?.label || "")}" maxlength="32" placeholder="e.g. Family">
    </label>
    <label class="field">Your username
      <input id="pool-name" value="${esc(mine)}" maxlength="20" placeholder="e.g. Jon">
    </label>
    <div class="members">${chips}</div>
    <button class="primary" id="share-pool-btn" type="button">Share this group</button>
    <button class="ghost" id="new-group-btn" type="button">Start another group</button>
    <button class="ghost danger" id="delete-group-btn" type="button">Remove this group</button>
  `;
  if (els.groupPill) els.groupPill.textContent = activeGroup()?.label || "My group";
  syncWithUi();
}

function renderAll() {
  els.season.textContent = `NFL ${state.seasonYear || nflSeasonYear()} · live`;
  renderWeeks();
  renderGames();
  renderParlay();
  renderPool();
  renderStack();
}

async function loadWeek(week?: number, silent = false) {
  const snap = await loadNflSnapshot();
  const want = week || state.week || snap?.currentWeek;
  if (snap) {
    if (!state.weeks.length) state.weeks = snap.weeks;
    state.seasonYear = snap.year;
    state.seasonType = snap.seasonType || 2;
    if (want && snap.byWeek[String(want)]?.length && !silent) {
      state.week = want;
      state.events = snap.byWeek[String(want)].slice().map(attachOdds).sort((a, b) => a.date.localeCompare(b.date));
      renderAll();
    }
  }
  if (!silent && !state.events.length) setBanner("Loading schedule…");
  try {
    const data = await fetchScoreboard(want, state.seasonType);
    state.seasonYear = data.season?.year || snap?.year || nflSeasonYear();
    state.seasonType = data.season?.type || 2;
    state.week = data.week?.number || want || 1;
    if (!state.weeks.length) state.weeks = parseCalendar(data);
    if (!state.weeks.length) {
      state.weeks = Array.from({ length: 18 }, (_, i) => ({ week: i + 1, label: `Week ${i + 1}` }));
    }
    state.events = (data.events || []).map(attachOdds).sort((a, b) => a.date.localeCompare(b.date));
    try {
      const live = await fetchBoardLines(state.week || undefined);
      if (Object.keys(live).length) state.events = overlayLines(state.events, live);
    } catch {
      /* snapshot / scoreboard lines still apply */
    }
    setBanner("", false);
    renderAll();
  } catch (err) {
    if (state.events.length) {
      setBanner("", false);
      return;
    }
    throw err;
  }
}

async function ensureSession() {
  let sessionId = (await idbGet<string>("sessionId")) || storeGet<string>("sessionId");
  const stored = await loadGroups();
  const returning = Boolean(sessionId || stored?.groups.length);
  const seen = (await idbGet<boolean>("seenRules")) ?? storeGet<boolean>("seenRules");
  let pool = emptyPool();
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_LS) || "null");
    if (legacy?.me?.id && !sessionId) sessionId = legacy.me.id;
    if (legacy?.pool) pool = mergePools(pool, sanitizePool(legacy.pool));
    if (legacy) localStorage.removeItem(LEGACY_LS);
  } catch {
    /* ignore */
  }
  const leftover = sanitizePool((await idbGet<Pool>("pool")) || storeGet<Pool>("pool"));
  state.sessionId = sessionId || uid();
  state.stake = clampStake((await idbGet<number>("stake")) ?? storeGet<number>("stake") ?? 10);
  const storedName = cleanName((await idbGet<string>("username")) || storeGet<string>("username"));

  if (stored?.groups.length) {
    state.groups = stored.groups;
    state.activeId = stored.activeId;
    state.pool = sanitizePool(activeGroup()?.pool || emptyPool());
  } else {
    const g = newGroup("My group", generateRoomCode(), uid());
    g.pool = leftover.sessions.length || Object.keys(leftover.votes).length ? leftover : pool;
    state.groups = [g];
    state.activeId = g.id;
    state.pool = sanitizePool(g.pool);
  }
  if (!state.pool.sessions.includes(state.sessionId)) state.pool.sessions.push(state.sessionId);
  if (storedName) state.pool = setDisplayName(state.pool, state.sessionId, storedName);
  state.seenRules = seen === true || returning;
  await persist();
}

let connecting = false;
async function connectGroup(code: string) {
  if (connecting) return;
  connecting = true;
  try {
    await sleep(350);
    try {
      await joinWithRetry(room, code);
    } catch {
      try {
        await room.host(code);
      } catch {
        state.roomStatus = "Saved on this phone";
        renderPool();
      }
    }
  } finally {
    connecting = false;
  }
}

async function switchGroup(id: string) {
  if (id === state.activeId) return;
  snapshotActive();
  const next = state.groups.find((g) => g.id === id);
  if (!next) return;
  state.activeId = id;
  state.withConfirmed = true;
  state.pool = sanitizePool(next.pool);
  if (!state.pool.sessions.includes(state.sessionId)) state.pool.sessions.push(state.sessionId);
  await persist();
  await connectGroup(next.code);
  renderAll();
}

async function startAnotherGroup() {
  if (state.groups.length >= MAX_GROUPS) {
    setBanner("That’s enough groups on this phone. Switch one you already have.");
    return;
  }
  const label = window.prompt("Name this group", "In-laws")?.trim();
  if (!label) return;
  snapshotActive();
  const g = newGroup(label, generateRoomCode(), uid());
  state.groups.push(g);
  state.activeId = g.id;
  state.pool = emptyPool();
  state.pool.sessions.push(state.sessionId);
  const name = state.pool.names[state.sessionId] || cleanName((await idbGet<string>("username")) || storeGet<string>("username"));
  if (name) state.pool = setDisplayName(state.pool, state.sessionId, name);
  await persist();
  await connectGroup(g.code);
  state.withConfirmed = true;
  closeGroupSheet();
  renderAll();
}

async function deleteGroup(id: string) {
  const g = state.groups.find((x) => x.id === id);
  if (!g) return;
  const name = g.label || "this group";
  if (!window.confirm(`Remove ${name} from this phone? Picks for that group will be gone here.`)) return;
  const wasActive = id === state.activeId;
  state.groups = state.groups.filter((x) => x.id !== id);
  if (!state.groups.length) {
    const fresh = newGroup("My group", generateRoomCode(), uid());
    fresh.pool.sessions.push(state.sessionId);
    const storedName = cleanName((await idbGet<string>("username")) || storeGet<string>("username"));
    if (storedName) fresh.pool = setDisplayName(fresh.pool, state.sessionId, storedName);
    state.groups = [fresh];
    state.activeId = fresh.id;
    state.pool = sanitizePool(fresh.pool);
    room.teardown();
    await persist();
    void connectGroup(fresh.code);
    renderAll();
    return;
  }
  if (wasActive) {
    const next = [...state.groups].sort((a, b) => b.lastUsed - a.lastUsed)[0];
    state.activeId = next.id;
    state.withConfirmed = true;
    state.pool = sanitizePool(next.pool);
    if (!state.pool.sessions.includes(state.sessionId)) state.pool.sessions.push(state.sessionId);
    room.teardown();
    await persist();
    void connectGroup(next.code);
  } else {
    await persist();
  }
  renderAll();
}

function inviteUrl(code: string) {
  const url = new URL(location.origin + location.pathname);
  url.searchParams.set("g", normalizeRoomCode(code));
  const label = activeGroup()?.label;
  if (label) url.searchParams.set("n", label);
  return url.toString();
}

async function shareRoom() {
  const g = activeGroup();
  const code = normalizeRoomCode(g?.code);
  if (!g || !code) {
    setBanner("Open a group first, then share.");
    return;
  }
  const url = inviteUrl(code);
  try {
    if (navigator.share) {
      await navigator.share({ url });
      return;
    }
    await navigator.clipboard.writeText(url);
    setBanner("Link copied.");
    setTimeout(() => setBanner("", false), 2500);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return;
    try {
      await navigator.clipboard.writeText(url);
      setBanner("Link copied.");
      setTimeout(() => setBanner("", false), 2500);
    } catch {
      setBanner(err instanceof Error ? err.message : "Could not share");
    }
  }
}

function vote(gameId: string, abbr: string) {
  const event = state.events.find((e) => e.id === gameId);
  if (!event || isLocked(event) || !state.sessionId) return;
  if (needsGroupChoice()) {
    state.pendingPick = { gameId, abbr };
    openGroupSheet();
    return;
  }
  state.pool = applyVote(state.pool, state.sessionId, gameId, abbr);
  void persist();
  if (navigator.vibrate) navigator.vibrate(12);
  renderGames();
  renderParlay();
  const current = state.pool.votes[gameId]?.[state.sessionId] || "";
  if (room.isHost) room.broadcastPool();
  else room.sendVote(state.sessionId, gameId, current);
}

function pushName() {
  const name = state.pool.names[state.sessionId] || "";
  if (room.isHost) room.broadcastPool();
  else room.sendName(state.sessionId, name);
}

els.weekRail.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("[data-week]");
  if (!btn) return;
  loadWeek(Number((btn as HTMLElement).dataset.week)).catch((err) => setBanner(err.message));
});

els.games.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest(".team-btn") as HTMLButtonElement | null;
  if (!btn || btn.disabled) return;
  vote(btn.dataset.game!, btn.dataset.abbr!);
});

els.stackBar.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("[data-stake]") as HTMLElement | null;
  if (!btn?.dataset.stake) return;
  setStake(btn.dataset.stake);
});

document.querySelector(".tabbar")!.addEventListener("click", (e) => {
  const btn = (e.target as HTMLElement).closest("[data-tab]") as HTMLElement | null;
  if (!btn) return;
  state.tab = btn.dataset.tab || "games";
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", (t as HTMLElement).dataset.tab === state.tab));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${state.tab}`));
  if (state.tab === "games" && needsGroupChoice()) openGroupSheet();
});

els.shareBtn.addEventListener("click", () => void shareRoom());
document.addEventListener("click", (e) => {
  const t = e.target as HTMLElement;
  if (t.id === "share-pool-btn") void shareRoom();
  if (t.id === "new-group-btn" || t.id === "sheet-new-group") void startAnotherGroup();
  if (t.id === "delete-group-btn") {
    const id = state.activeId;
    if (id) void deleteGroup(id);
    return;
  }
  const drop = t.closest("[data-delete]") as HTMLElement | null;
  if (drop?.dataset.delete) {
    void deleteGroup(drop.dataset.delete);
    return;
  }
  const pickWith = t.closest("[data-pick-with]") as HTMLElement | null;
  if (pickWith?.dataset.pickWith) void chooseGroup(pickWith.dataset.pickWith);
  const stakeBtn = t.closest("[data-stake]") as HTMLElement | null;
  if (stakeBtn?.dataset.stake && !els.stackBar.contains(stakeBtn)) setStake(stakeBtn.dataset.stake);
  const sw = t.closest("[data-switch]") as HTMLElement | null;
  if (sw?.dataset.switch) void switchGroup(sw.dataset.switch);
});

els.groupPill.addEventListener("click", () => openGroupSheet());
els.withBar.addEventListener("click", () => openGroupSheet());

document.addEventListener("change", (e) => {
  const t = e.target as HTMLInputElement;
  if (t.id === "pool-name") {
    state.pool = setDisplayName(state.pool, state.sessionId, t.value);
    void persist();
    pushName();
    renderPool();
    renderGames();
  }
  if (t.id === "stake-amount") setStake(t.value);
  if (t.id === "group-label") {
    const g = activeGroup();
    if (g) g.label = t.value.trim().slice(0, 32) || g.label;
    void persist();
    renderPool();
  }
});

function hideRules() {
  els.rulesGate.hidden = true;
}

const RULES_LEDE = "Pick NFL games with friends. The group parlay is only the games you all agree on.";

function showRules(groupLabel?: string) {
  const who = (groupLabel || "").trim();
  els.rulesLede.textContent = who
    ? `You're picking with ${who}. Add a name so they know it's you.`
    : RULES_LEDE;
  els.rulesName.value = state.pool.names[state.sessionId] || "";
  els.rulesGate.hidden = false;
}

els.rulesGo.addEventListener("click", () => {
  const name = cleanName(els.rulesName.value);
  if (name) {
    state.pool = setDisplayName(state.pool, state.sessionId, name);
    void persist();
    pushName();
  }
  hideRules();
  state.seenRules = true;
  void persist();
  renderAll();
  if (needsGroupChoice()) openGroupSheet();
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  loadWeek(state.week ?? undefined, true).catch(() => {});
  const code = activeGroup()?.code;
  if (code && !room.peer) void connectGroup(code);
});

async function boot() {
  await ensureSession();
  const q = new URLSearchParams(location.search);
  const linkCode = normalizeRoomCode(q.get("g") || q.get("room") || "");
  const linkName = q.get("n")?.trim();
  if (linkCode) {
    state.withConfirmed = true;
    const existing = state.groups.find((g) => normalizeRoomCode(g.code) === linkCode);
    if (existing) {
      if (existing.id !== state.activeId) await switchGroup(existing.id);
      else void connectGroup(existing.code);
    } else if (state.groups.length >= MAX_GROUPS) {
      setBanner("Too many groups on this phone. Open Groups and switch.");
    } else {
      snapshotActive();
      const g = newGroup(linkName || "Shared group", linkCode, uid());
      state.groups.push(g);
      state.activeId = g.id;
      state.pool = emptyPool();
      state.pool.sessions.push(state.sessionId);
      await persist();
      void connectGroup(linkCode);
      renderAll();
    }
    history.replaceState(null, "", location.pathname);
    showRules(activeGroup()?.label || linkName);
  } else {
    const code = activeGroup()?.code;
    if (code) void connectGroup(code);
    if (!state.seenRules) showRules();
    else hideRules();
  }
  try {
    await loadWeek();
  } catch (err) {
    setBanner(err instanceof Error ? err.message : "Could not load the NFL schedule.");
  }
  const refresh = () => {
    loadWeek(state.week ?? undefined, true).catch(() => {});
    window.setTimeout(refresh, scoreboardPollMs(state.events));
  };
  window.setTimeout(refresh, scoreboardPollMs(state.events));
  window.setInterval(() => {
    if (state.tab === "games") renderGames();
  }, 20_000);
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
}

void boot();

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";

export function nflSeasonYear(now = new Date()): number {
  return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

export type NflSnapshot = {
  generatedAt: string;
  year: number;
  seasonType: number;
  currentWeek: number;
  weeks: Array<{ week: number; label: string }>;
  byWeek: Record<string, NflEvent[]>;
};

let snapshotCache: NflSnapshot | null | undefined;

export async function loadNflSnapshot(): Promise<NflSnapshot | null> {
  if (snapshotCache !== undefined) return snapshotCache;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/nfl.json`, { cache: "no-store" });
    if (!res.ok) {
      snapshotCache = null;
      return null;
    }
    snapshotCache = (await res.json()) as NflSnapshot;
    return snapshotCache;
  } catch {
    snapshotCache = null;
    return null;
  }
}

export async function fetchScoreboard(week?: number, seasonType = 2): Promise<NflScoreboard> {
  const url = new URL(SCOREBOARD);
  url.searchParams.set("year", String(nflSeasonYear()));
  url.searchParams.set("seasontype", String(seasonType));
  url.searchParams.set("limit", "200");
  if (week) url.searchParams.set("week", String(week));
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load the NFL schedule");
  return res.json();
}

export type NflTeam = {
  abbreviation: string;
  displayName: string;
  shortDisplayName: string;
  logo: string;
  color?: string;
  alternateColor?: string;
};

export type NflCompetitor = {
  homeAway: string;
  score?: string;
  winner?: boolean;
  team: NflTeam;
};

export type SideLine = { home: number | null; away: number | null };

export type NflEvent = {
  id: string;
  date: string;
  shortName?: string;
  moneyline?: SideLine;
  spread?: SideLine;
  competitions: Array<{
    competitors: NflCompetitor[];
    odds?: Array<{
      details?: string;
      spread?: number;
      moneyline?: {
        home?: { close?: { odds?: string } };
        away?: { close?: { odds?: string } };
      };
      homeTeamOdds?: { moneyLine?: number };
      awayTeamOdds?: { moneyLine?: number };
      pointSpread?: {
        home?: { close?: { line?: string } };
        away?: { close?: { line?: string } };
      };
    }>;
  }>;
  status?: {
    type?: {
      state?: string;
      completed?: boolean;
      shortDetail?: string;
    };
  };
};

export type NflScoreboard = {
  season?: { year?: number; type?: number };
  week?: { number?: number };
  leagues?: Array<{
    calendar?: Array<{
      value?: string;
      entries?: Array<{ value: string; label: string; detail?: string }>;
    }>;
  }>;
  events?: NflEvent[];
};

export function parseCalendar(data: NflScoreboard): Array<{ week: number; label: string }> {
  const cal = data.leagues?.[0]?.calendar || [];
  const regular = cal.find((c) => String(c.value) === "2") || cal[1] || cal[0];
  return (regular?.entries || []).map((e) => ({
    week: Number(e.value),
    label: e.label,
  }));
}

export const EVEN_MONEY = -110;

export function parseAmerican(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) return Math.round(raw);
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/[^+-\d]/g, ""));
  if (!Number.isFinite(n) || n === 0) return null;
  return n;
}

export function americanToDecimal(american: number): number {
  return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american);
}

export function decimalToAmerican(decimal: number): number {
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

export function formatAmerican(american: number): string {
  return american > 0 ? `+${american}` : String(american);
}

export function parseLine(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string") return null;
  const n = Number(raw.replace(/[^+\-\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function formatSpread(line: number): string {
  if (line === 0) return "PK";
  const abs = Math.abs(line);
  const body = abs % 1 === 0 ? String(abs) : abs.toFixed(1);
  return line > 0 ? `+${body}` : `-${body}`;
}

export function extractSpread(event: NflEvent): SideLine | undefined {
  const o = event.competitions?.[0]?.odds?.[0];
  if (!o && event.spread) return event.spread;
  if (!o) return event.spread;
  let home = parseLine(o.pointSpread?.home?.close?.line);
  let away = parseLine(o.pointSpread?.away?.close?.line);
  if (home == null && typeof o.spread === "number") home = o.spread;
  if (home != null && away == null) away = -home;
  if (away != null && home == null) home = -away;
  if (home == null && away == null) return event.spread;
  return { home, away };
}

export function extractMoneyline(event: NflEvent): SideLine | undefined {
  const o = event.competitions?.[0]?.odds?.[0];
  if (!o) return event.moneyline;
  const home = parseAmerican(o.moneyline?.home?.close?.odds) ?? parseAmerican(o.homeTeamOdds?.moneyLine);
  const away = parseAmerican(o.moneyline?.away?.close?.odds) ?? parseAmerican(o.awayTeamOdds?.moneyLine);
  if (home == null && away == null) return event.moneyline;
  return { home, away };
}

export function attachOdds(event: NflEvent): NflEvent {
  const comps = event.competitions?.[0];
  return {
    ...event,
    moneyline: extractMoneyline(event),
    spread: extractSpread(event),
    competitions: comps ? [{ competitors: comps.competitors }] : event.competitions,
  };
}

export function eventMatchKey(event: NflEvent): string {
  const { away, home } = teamsOf(event);
  return `${away.team.abbreviation}@${home.team.abbreviation}`.toUpperCase();
}

export function overlayLines(
  events: NflEvent[],
  lines: Record<string, { moneyline?: SideLine; spread?: SideLine }>,
): NflEvent[] {
  return events.map((ev) => {
    const line = lines[eventMatchKey(ev)];
    if (!line) return ev;
    return {
      ...ev,
      moneyline: line.moneyline ?? ev.moneyline,
      spread: line.spread ?? ev.spread,
    };
  });
}

type AnGame = {
  away_team_id?: number;
  home_team_id?: number;
  teams?: Array<{ id?: number; abbr?: string }>;
  odds?: Array<{
    type?: string;
    book_id?: number;
    ml_home?: number | null;
    ml_away?: number | null;
    spread_home?: number | null;
    spread_away?: number | null;
  }>;
};

export async function fetchBoardLines(week?: number): Promise<Record<string, { moneyline?: SideLine; spread?: SideLine }>> {
  const url = new URL("https://api.actionnetwork.com/web/v1/scoreboard/nfl");
  if (week) url.searchParams.set("week", String(week));
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load live odds");
  const data = (await res.json()) as { games?: AnGame[] };
  const out: Record<string, { moneyline?: SideLine; spread?: SideLine }> = {};
  for (const g of data.games || []) {
    const away = g.teams?.find((t) => t.id === g.away_team_id);
    const home = g.teams?.find((t) => t.id === g.home_team_id);
    if (!away?.abbr || !home?.abbr) continue;
    const gameOdds = (g.odds || []).filter((o) => o.type === "game");
    const pick =
      gameOdds.find((o) => o.book_id === 15 && (o.ml_home != null || o.spread_home != null)) ||
      gameOdds.find((o) => o.ml_home != null || o.spread_home != null);
    if (!pick) continue;
    const row: { moneyline?: SideLine; spread?: SideLine } = {};
    if (pick.ml_home != null && pick.ml_away != null) {
      row.moneyline = { home: pick.ml_home, away: pick.ml_away };
    }
    if (pick.spread_home != null || pick.spread_away != null) {
      row.spread = { home: pick.spread_home ?? (pick.spread_away != null ? -pick.spread_away : null), away: pick.spread_away ?? (pick.spread_home != null ? -pick.spread_home : null) };
    }
    out[`${away.abbr}@${home.abbr}`.toUpperCase()] = row;
  }
  return out;
}
export function moneylineFor(event: NflEvent, abbr: string): number {
  const { away, home } = teamsOf(event);
  if (away.team.abbreviation === abbr) return event.moneyline?.away ?? EVEN_MONEY;
  if (home.team.abbreviation === abbr) return event.moneyline?.home ?? EVEN_MONEY;
  return EVEN_MONEY;
}

export function spreadFor(event: NflEvent, abbr: string): number | null {
  const { away, home } = teamsOf(event);
  if (away.team.abbreviation === abbr) return event.spread?.away ?? null;
  if (home.team.abbreviation === abbr) return event.spread?.home ?? null;
  return null;
}

export function spreadHeadline(event: NflEvent): string {
  const { away, home } = teamsOf(event);
  const sh = event.spread?.home;
  const sa = event.spread?.away;
  if (sh == null && sa == null) return "";
  if (sh === 0 || sa === 0) return "Pick'em";
  if (sh != null && sh < 0) return `${home.team.abbreviation} ${formatSpread(sh)}`;
  if (sa != null && sa < 0) return `${away.team.abbreviation} ${formatSpread(sa)}`;
  if (sh != null) return `${home.team.abbreviation} ${formatSpread(sh)}`;
  if (sa != null) return `${away.team.abbreviation} ${formatSpread(sa)}`;
  return "";
}

export function teamsOf(event: NflEvent): { away: NflCompetitor; home: NflCompetitor } {
  const comps = event.competitions[0].competitors;
  const away = comps.find((c) => c.homeAway === "away") || comps[1];
  const home = comps.find((c) => c.homeAway === "home") || comps[0];
  return { away, home };
}

export function isLocked(event: NflEvent): boolean {
  const kick = Date.parse(event.date);
  if (Number.isFinite(kick) && Date.now() >= kick) return true;
  const st = event.status?.type?.state;
  return Boolean(st && st !== "pre");
}

export function winnerAbbr(event: NflEvent): string | null {
  const { away, home } = teamsOf(event);
  if (away.winner) return away.team.abbreviation;
  if (home.winner) return home.team.abbreviation;
  const done = event.status?.type?.completed === true || event.status?.type?.state === "post";
  if (!done) return null;
  const as = Number(away.score);
  const hs = Number(home.score);
  if (Number.isNaN(as) || Number.isNaN(hs)) return null;
  if (hs > as) return home.team.abbreviation;
  if (as > hs) return away.team.abbreviation;
  return null;
}

/** How often to refresh scores: tight around kickoff and live games. */
export function scoreboardPollMs(events: NflEvent[]): number {
  const now = Date.now();
  let nextKick = Infinity;
  let live = false;
  for (const e of events) {
    const st = e.status?.type?.state;
    if (st === "in") live = true;
    const t = Date.parse(e.date);
    if (Number.isFinite(t) && t > now) nextKick = Math.min(nextKick, t);
  }
  if (live) return 20_000;
  const until = nextKick - now;
  if (until < 5 * 60_000) return 15_000;
  if (until < 60 * 60_000) return 45_000;
  return 180_000;
}

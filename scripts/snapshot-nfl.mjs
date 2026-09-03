#!/usr/bin/env node
/**
 * Pulls the NFL regular-season slate and writes public/data/nfl.json
 * so phones can paint games before the live feed answers.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCOREBOARD = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "public/data/nfl.json");

function seasonYear(now = new Date()) {
  return now.getMonth() < 3 ? now.getFullYear() - 1 : now.getFullYear();
}

function slimTeam(t) {
  return {
    abbreviation: t.abbreviation,
    displayName: t.displayName,
    shortDisplayName: t.shortDisplayName,
    logo: t.logo,
    color: t.color,
    alternateColor: t.alternateColor,
  };
}

function slimSpread(e) {
  const o = e.competitions?.[0]?.odds?.[0];
  if (!o) return undefined;
  const parse = (raw) => {
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw !== "string") return null;
    const n = Number(raw.replace(/[^+\-\d.]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  let home = parse(o.pointSpread?.home?.close?.line);
  let away = parse(o.pointSpread?.away?.close?.line);
  if (home == null && typeof o.spread === "number") home = o.spread;
  if (home != null && away == null) away = -home;
  if (away != null && home == null) home = -away;
  if (home == null && away == null) return undefined;
  return { home, away };
}

function slimOdds(e) {
  const o = e.competitions?.[0]?.odds?.[0];
  if (!o) return undefined;
  const parse = (raw) => {
    if (typeof raw === "number" && Number.isFinite(raw) && raw !== 0) return Math.round(raw);
    if (typeof raw !== "string") return null;
    const n = Number(raw.replace(/[^+-\d]/g, ""));
    return Number.isFinite(n) && n !== 0 ? n : null;
  };
  const home = parse(o.moneyline?.home?.close?.odds) ?? parse(o.homeTeamOdds?.moneyLine);
  const away = parse(o.moneyline?.away?.close?.odds) ?? parse(o.awayTeamOdds?.moneyLine);
  if (home == null && away == null) return undefined;
  return { home, away };
}

function matchKey(away, home) {
  return `${away}@${home}`.toUpperCase();
}

async function actionLines(week) {
  const url = new URL("https://api.actionnetwork.com/web/v1/scoreboard/nfl");
  url.searchParams.set("week", String(week));
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 PoolParlaySnapshot", Accept: "application/json" },
  });
  if (!res.ok) return {};
  const data = await res.json();
  const out = {};
  for (const g of data.games || []) {
    const away = (g.teams || []).find((t) => t.id === g.away_team_id);
    const home = (g.teams || []).find((t) => t.id === g.home_team_id);
    if (!away?.abbr || !home?.abbr) continue;
    const gameOdds = (g.odds || []).filter((o) => o.type === "game");
    const pick =
      gameOdds.find((o) => o.book_id === 15 && (o.ml_home != null || o.spread_home != null)) ||
      gameOdds.find((o) => o.ml_home != null || o.spread_home != null);
    if (!pick) continue;
    const row = {};
    if (pick.ml_home != null && pick.ml_away != null) {
      row.moneyline = { home: pick.ml_home, away: pick.ml_away };
    }
    if (pick.spread_home != null || pick.spread_away != null) {
      row.spread = {
        home: pick.spread_home ?? (pick.spread_away != null ? -pick.spread_away : null),
        away: pick.spread_away ?? (pick.spread_home != null ? -pick.spread_home : null),
      };
    }
    out[matchKey(away.abbr, home.abbr)] = row;
  }
  return out;
}

function slimEvent(e) {
  const comps = e.competitions?.[0]?.competitors || [];
  return {
    id: e.id,
    date: e.date,
    shortName: e.shortName,
    moneyline: slimOdds(e),
    spread: slimSpread(e),
    competitions: [
      {
        competitors: comps.map((c) => ({
          homeAway: c.homeAway,
          score: c.score,
          winner: c.winner,
          team: slimTeam(c.team),
        })),
      },
    ],
    status: {
      type: {
        state: e.status?.type?.state,
        completed: e.status?.type?.completed,
        shortDetail: e.status?.type?.shortDetail,
      },
    },
  };
}

async function scoreboard(year, week, seasonType = 2) {
  const url = new URL(SCOREBOARD);
  url.searchParams.set("year", String(year));
  url.searchParams.set("seasontype", String(seasonType));
  url.searchParams.set("limit", "200");
  if (week) url.searchParams.set("week", String(week));
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return res.json();
}

const year = seasonYear();
const current = await scoreboard(year);
const seasonType = current.season?.type || 2;
const currentWeek = current.week?.number || 1;
const cal = current.leagues?.[0]?.calendar || [];
const regular = cal.find((c) => String(c.value) === "2") || cal[1] || cal[0];
const weeks = (regular?.entries || []).map((e) => ({
  week: Number(e.value),
  label: e.label,
}));
const weekNums = weeks.length ? weeks.map((w) => w.week) : Array.from({ length: 18 }, (_, i) => i + 1);

const byWeek = {};
let lined = 0;
for (const w of weekNums) {
  const data = w === currentWeek ? current : await scoreboard(year, w, seasonType);
  const board = await actionLines(w);
  byWeek[String(w)] = (data.events || []).map((e) => {
    const ev = slimEvent(e);
    const away = ev.competitions[0].competitors.find((c) => c.homeAway === "away") || ev.competitions[0].competitors[1];
    const home = ev.competitions[0].competitors.find((c) => c.homeAway === "home") || ev.competitions[0].competitors[0];
    const live = board[matchKey(away.team.abbreviation, home.team.abbreviation)];
    if (live?.moneyline) {
      ev.moneyline = live.moneyline;
      lined += 1;
    }
    if (live?.spread) ev.spread = live.spread;
    return ev;
  });
  process.stdout.write(`week ${w}: ${byWeek[String(w)].length} games\n`);
}

const payload = {
  generatedAt: new Date().toISOString(),
  year: current.season?.year || year,
  seasonType,
  currentWeek,
  weeks: weeks.length ? weeks : weekNums.map((w) => ({ week: w, label: `Week ${w}` })),
  byWeek,
};

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload));
console.log(`wrote ${OUT} (${(JSON.stringify(payload).length / 1024).toFixed(1)} KB, ${lined} live moneylines)`);

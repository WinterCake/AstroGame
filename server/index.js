import "dotenv/config";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import { loginFromEnv } from "../src/auth.js";
import { Session } from "../src/session.js";
import { getBuildings } from "../src/buildings.js";
import { listEmpirePlanets, scanEmpireResources, dedupePlanets, dedupePlanetsByCoords } from "../src/empire.js";
import { scrapeGalaxy } from "../src/galaxy.js";
import { groupEntriesByPlayer } from "../src/galaxy.js";
import {
  buildAttackTargets,
  saveAttacksStore,
  sendAttackLootMissions,
} from "../src/attack-loot-send.js";
import {
  clearAttacksForDay,
  countAttacksToday,
  emptyAttacksStore,
  getAttackedTodayCoords,
  getAttacksHistoryList,
  getAttacksTodayList,
  mergeAttackRecords,
  migrateLegacyTimestamps,
  normalizeAttacksStore,
  removeAttackCoords,
  serializeAttacksStore,
} from "../src/attacks-history.js";
import { getClient, refreshClient } from "../src/client.js";
import { ensureDataDirs, paths } from "../src/paths.js";
import { fetchFleetSlotStatus, parseCoordLine, sendSpyMissions } from "../src/spy-send.js";
import { fetchActiveFleets } from "../src/fleet-active.js";
import {
  filterSpyReports,
  getSpiedTodayCoords,
  isReportToday,
  scrapeSpyReports,
  writeSpyReportsExcel,
} from "../src/spy-reports.js";
import { createJob, getJob, runJob, serializeJob } from "./jobs.js";

const PORT = Number(process.env.ASTROGAME_UI_PORT) || 3847;
const HOST = process.env.ASTROGAME_UI_HOST || "127.0.0.1";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

ensureDataDirs();

const app = Fastify({ logger: false });

await app.register(cors, { origin: true });

function loadJson(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function getSpyEnrichmentContext() {
  const attacked = loadJson(paths.attacks.import());
  const attackedTodaySet = getAttackedTodayCoords(attacked);
  const galaxy = loadJson(paths.galaxy.global());
  const galaxyByCoord = new Map((galaxy?.entries ?? []).map((e) => [e.coords, e]));
  return { attackedTodaySet, attacksTodayCount: countAttacksToday(attacked), galaxyByCoord };
}

function enrichSpyReport(report, { attackedTodaySet, galaxyByCoord }) {
  const g = galaxyByCoord.get(report.coords);
  const attackedToday = attackedTodaySet.has(report.coords);
  return {
    ...report,
    rank: g?.rank ?? null,
    points: g?.points ?? null,
    inactive: g?.inactive ?? null,
    isAttackableInactive: g?.isAttackableInactive ?? null,
    onVacation: g?.onVacation ?? null,
    activityLabel: g?.activityLabel ?? null,
    attackedToday,
    alreadyAttacked: attackedToday,
  };
}

function loadSpyReportsData() {
  return loadJson(paths.spy.lootTargets()) ?? loadJson(paths.spy.reports()) ?? { reports: [], meta: {} };
}

function loadSpiedTodayContext() {
  const data = loadSpyReportsData();
  const spiedTodaySet = getSpiedTodayCoords(data.reports);
  return { spiedTodaySet, spiedTodayCount: spiedTodaySet.size };
}

function enrichGalaxyEntry(entry, { spiedTodaySet }) {
  return {
    ...entry,
    spiedToday: spiedTodaySet.has(entry.coords),
  };
}

function coordsToTarget(coords) {
  if (typeof coords === "string") return parseCoordLine(coords);
  if (coords?.galaxy != null) return coords;
  return null;
}

function filterGalaxyEntries(entries, query) {
  let filtered = entries;

  if (query.inactive === "true") {
    filtered = filtered.filter((e) => e.inactive);
  } else if (query.inactive === "attackable") {
    filtered = filtered.filter((e) => e.isAttackableInactive);
  }

  if (query.vacation === "false") {
    filtered = filtered.filter((e) => !e.onVacation);
  }

  if (query.player) {
    const term = String(query.player).toLowerCase();
    filtered = filtered.filter((e) => e.username?.toLowerCase().includes(term));
  }

  if (query.galaxy) {
    const g = Number(query.galaxy);
    filtered = filtered.filter((e) => e.galaxy === g);
  }

  if (query.system) {
    const s = Number(query.system);
    filtered = filtered.filter((e) => e.system === s);
  }

  if (query.minRank) {
    const min = Number(query.minRank);
    filtered = filtered.filter((e) => (e.rank ?? Infinity) >= min);
  }

  if (query.maxRank) {
    const max = Number(query.maxRank);
    filtered = filtered.filter((e) => (e.rank ?? 0) <= max);
  }

  if (query.search) {
    const term = String(query.search).toLowerCase();
    filtered = filtered.filter(
      (e) =>
        e.coords?.includes(term) ||
        e.username?.toLowerCase().includes(term) ||
        e.planetName?.toLowerCase().includes(term) ||
        e.alliance?.tag?.toLowerCase().includes(term)
    );
  }

  return filtered;
}

function sortRows(rows, sortBy, sortDir, accessors = {}) {
  const dir = sortDir === "desc" ? -1 : 1;
  const key = sortBy || "coords";
  const get = accessors[key] ?? ((row) => row[key]);
  return [...rows].sort((a, b) => {
    const av = get(a);
    const bv = get(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
    return String(av).localeCompare(String(bv), "fr", { numeric: true }) * dir;
  });
}

// --- Session ---

app.get("/api/session", async () => {
  try {
    const session = Session.loadFromFile() ?? new Session();
    const envCookies = process.env.ASTROGAME_COOKIES?.trim();
    if (envCookies) session.loadFromHeader(envCookies);
    const hasCookies = Boolean(session.toHeader());
    return {
      ok: true,
      connected: hasCookies,
      cookies: session.cookies.size,
    };
  } catch (error) {
    return { ok: false, connected: false, error: error.message };
  }
});

app.post("/api/session/login", async (_req, reply) => {
  try {
    await loginFromEnv();
    await refreshClient();
    return { ok: true };
  } catch (error) {
    reply.code(500);
    return { ok: false, error: error.message };
  }
});

// --- Empire ---

app.get("/api/empire/planets", async (_req, reply) => {
  try {
    const client = await getClient();
    const planets = await listEmpirePlanets(client, { forSource: true });
    return { planets };
  } catch (error) {
    reply.code(500);
    return { error: error.message };
  }
});

app.get("/api/empire/snapshot", async () => {
  const snapshot = loadJson(paths.empire.snapshot());
  if (!snapshot) return { snapshot: null };
  if (Array.isArray(snapshot.planets)) {
    snapshot.planets = dedupePlanetsByCoords(dedupePlanets(snapshot.planets));
  }
  return { snapshot };
});

app.post("/api/empire/scan", async (_req, reply) => {
  const job = createJob("empire-scan");
  runJob(job.id, async (onProgress) => {
    const client = await getClient();
    const payload = await scanEmpireResources(client, {
      onPlanet: ({ index, total, planet }) => {
        onProgress({ index, total, coords: planet.coords });
      },
    });
    return payload;
  }).catch(() => {});
  return { jobId: job.id };
});

app.get("/api/empire/buildings", async (req, reply) => {
  try {
    const cp = req.query.cp ? Number(req.query.cp) : undefined;
    const client = await getClient();
    const page = await getBuildings(client, cp ? { cp } : {});
    return page;
  } catch (error) {
    reply.code(500);
    return { error: error.message };
  }
});

// --- Galaxy ---

app.get("/api/galaxy/meta", async () => {
  const data = loadJson(paths.galaxy.global());
  if (!data) return { exists: false };
  return { exists: true, meta: data.meta };
});

app.get("/api/galaxy/entries", async (req) => {
  const data = loadJson(paths.galaxy.global());
  if (!data?.entries) {
    return { entries: [], total: 0, meta: null };
  }

  const spyCtx = loadSpiedTodayContext();
  let filtered = filterGalaxyEntries(data.entries, req.query);

  if (req.query.notSpiedToday === "true") {
    filtered = filtered.filter((e) => !spyCtx.spiedTodaySet.has(e.coords));
  }

  const enriched = filtered.map((e) => enrichGalaxyEntry(e, spyCtx));
  const sorted = sortRows(enriched, req.query.sortBy, req.query.sortDir, {
    alliance: (e) => e.alliance?.tag ?? "",
    coords: (e) => `${e.galaxy}:${String(e.system).padStart(3, "0")}:${e.position}`,
  });
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
  const start = (page - 1) * pageSize;
  const slice = sorted.slice(start, start + pageSize);

  return {
    meta: data.meta,
    entries: slice,
    total: sorted.length,
    page,
    pageSize,
    totalPages: Math.ceil(sorted.length / pageSize),
    spiedToday: spyCtx.spiedTodayCount,
  };
});

app.get("/api/galaxy/players", async (req) => {
  const data = loadJson(paths.galaxy.global());
  if (!data?.entries) return { players: [], total: 0 };

  let players = data.players ?? groupEntriesByPlayer(data.entries);

  if (req.query.inactive === "true") {
    players = players.filter((p) => p.inactivePlanets > 0);
  }

  if (req.query.search) {
    const term = String(req.query.search).toLowerCase();
    players = players.filter((p) => p.username?.toLowerCase().includes(term));
  }

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
  const start = (page - 1) * pageSize;

  return {
    players: players.slice(start, start + pageSize),
    total: players.length,
    page,
    pageSize,
  };
});

app.post("/api/galaxy/scrape", async (req) => {
  const body = req.body ?? {};
  const job = createJob("galaxy-scrape", { message: "Démarrage…" });

  runJob(job.id, async (onProgress) => {
    const client = await getClient();
    const options = {
      all: body.all ?? false,
      refresh: body.refresh ?? false,
      output: body.output ?? paths.galaxy.defaultScrape(),
    };
    if (body.galaxy) options.galaxy = body.galaxy;
    if (body.systems) options.system = body.systems;
    if (body.coords) {
      const [g, s] = String(body.coords).split(":").map(Number);
      options.coords = { galaxy: g, system: s };
    }

    const result = await scrapeGalaxy(options, client);
    onProgress({
      planetEntries: result.meta.planetEntries,
      message: "Scrape terminé",
    });
    return result;
  }).catch(() => {});

  return { jobId: job.id };
});

// --- Spy ---

app.get("/api/spy/slots", async (req, reply) => {
  try {
    const client = await getClient();
    const cp = req.query.cp ? Number(req.query.cp) : undefined;
    const status = await fetchFleetSlotStatus(client, cp);
    return status;
  } catch (error) {
    reply.code(500);
    return { error: error.message };
  }
});

app.get("/api/spy/reports", async (req) => {
  const data = loadSpyReportsData();
  let reports = data.reports ?? [];

  if (req.query.filter) {
    reports = filterSpyReports(reports, req.query.filter);
  }

  if (req.query.minLoot) {
    const min = Number(req.query.minLoot);
    reports = reports.filter((r) => (r.loot ?? 0) >= min);
  }

  if (req.query.sansDefense === "true") {
    reports = filterSpyReports(reports, "sans-defense");
  }

  const ctx = getSpyEnrichmentContext();

  if (req.query.notAttacked === "true") {
    reports = reports.filter((r) => !ctx.attackedTodaySet.has(r.coords));
  }

  if (req.query.spiedToday === "true") {
    reports = reports.filter(isReportToday);
  } else if (req.query.spiedToday === "false") {
    reports = reports.filter((r) => !isReportToday(r));
  }

  const enriched = reports.map((r) => enrichSpyReport(r, ctx));

  const sorted = sortRows(enriched, req.query.sortBy, req.query.sortDir, {
    loot: (r) => r.loot ?? 0,
    rank: (r) => r.rank ?? Infinity,
    timestamp: (r) => Number(r.timestamp) || 0,
    date: (r) => Number(r.timestamp) || 0,
  });

  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
  const start = (page - 1) * pageSize;

  return {
    meta: data.meta,
    reports: sorted.slice(start, start + pageSize),
    total: sorted.length,
    page,
    pageSize,
    attacksToday: ctx.attacksTodayCount,
  };
});

app.get("/api/spy/reports/detail", async (req, reply) => {
  const coords = String(req.query.coords ?? "").trim();
  if (!/^\d+:\d+:\d+$/.test(coords)) {
    reply.code(400);
    return { error: "coords invalide (G:S:P)" };
  }

  const data = loadSpyReportsData();
  const report = (data.reports ?? []).find((r) => r.coords === coords);
  if (!report) {
    reply.code(404);
    return { error: "Rapport introuvable" };
  }

  return { report: enrichSpyReport(report, getSpyEnrichmentContext()) };
});

app.post("/api/spy/reports/sync", async (req) => {
  const body = req.body ?? {};
  const job = createJob("spy-sync");

  runJob(job.id, async (onProgress) => {
    const client = await getClient();
    const output = body.output ?? paths.spy.reports();
    const lootOutput = body.lootOutput ?? paths.spy.lootTargets();
    const result = await scrapeSpyReports(
      {
        all: body.all !== false,
        maxPages: body.maxPages,
        output,
      },
      client
    );

    if (!body.noExcel) {
      await writeSpyReportsExcel(result, paths.spy.reportsExcel());
    }

    const { writeFileSync } = await import("node:fs");
    writeFileSync(lootOutput, JSON.stringify(result, null, 2), "utf8");
    onProgress({ totalReports: result.meta.totalReports, message: "Sync terminée" });
    return result;
  }).catch(() => {});

  return { jobId: job.id };
});

app.post("/api/spy/send", async (req, reply) => {
  const body = req.body ?? {};
  let coords = (body.coords ?? []).map(coordsToTarget).filter(Boolean);
  if (!coords.length) {
    reply.code(400);
    return { error: "coords requis (tableau de G:S:P)" };
  }

  const maxTargets = Number(body.maxTargets);
  if (Number.isFinite(maxTargets) && maxTargets > 0) {
    coords = coords.slice(0, maxTargets);
  }

  const job = createJob("spy-send", { total: coords.length, done: 0 });

  runJob(job.id, async (onProgress) => {
    const client = await getClient();
    const result = await sendSpyMissions(
      {
        coords,
        cp: body.cp ? Number(body.cp) : null,
        dryRun: Boolean(body.dryRun),
        parallel: body.parallel ?? (Number(process.env.SPY_SEND_PARALLEL) || 25),
        reserveSlots: body.reserveSlots ?? 0,
        onProgress: (progress) => onProgress(progress),
      },
      client
    );
    onProgress({
      done: result.results.length,
      total: coords.length,
      ok: result.results.filter((r) => r.ok).length,
    });
    return result;
  }).catch(() => {});

  return { jobId: job.id };
});

// --- Attacks ---

function loadAttacksStore() {
  let data = loadJson(paths.attacks.import()) ?? { attacks: [], meta: {} };
  const migrated = migrateLegacyTimestamps(data);
  if (migrated !== data) {
    saveAttacksStore(migrated);
    data = migrated;
  }
  return data;
}

function loadCoordsFromTextFile(filePath) {
  if (!existsSync(filePath)) return [];
  return [
    ...new Set(
      readFileSync(filePath, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .filter((line) => /^\d+:\d+:\d+$/.test(line))
    ),
  ];
}

function loadCoordsFromHistoryExports() {
  const coords = new Set();
  const dir = paths.attacks.historyDir();
  if (!existsSync(dir)) return [];

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    try {
      const payload = JSON.parse(readFileSync(join(dir, file), "utf8"));
      for (const value of payload.coords ?? []) {
        if (/^\d+:\d+:\d+$/.test(String(value))) coords.add(String(value));
      }
      for (const entry of payload.attacks ?? []) {
        const c = typeof entry === "string" ? entry : entry?.coords;
        if (c && /^\d+:\d+:\d+$/.test(String(c))) coords.add(String(c));
      }
    } catch {
      /* ignore invalid export */
    }
  }

  return [...coords];
}

function loadExternalAttackCoords() {
  const coords = new Set([
    ...loadCoordsFromTextFile(paths.attacks.previousTargets()),
    ...loadCoordsFromHistoryExports(),
  ]);
  return [...coords];
}

app.get("/api/attacks/import", async () => {
  const data = loadAttacksStore();
  const attacksToday = getAttacksTodayList(data);
  const attacksHistory = getAttacksHistoryList(data);
  const store = normalizeAttacksStore(data);
  const externalCoords = loadExternalAttackCoords();
  return {
    ...serializeAttacksStore(store, data.meta ?? {}),
    todayCount: countAttacksToday(data),
    historyCount: attacksHistory.length,
    attacksToday,
    attacksHistory,
    externalCoords,
  };
});

app.post("/api/attacks/import/merge-files", async () => {
  const coords = loadExternalAttackCoords();
  if (!coords.length) {
    return { ok: true, added: 0, message: "Aucune coordonnée dans les fichiers externes" };
  }

  const existing = loadAttacksStore();
  const before = getAttacksHistoryList(existing).length;
  const store = mergeAttackRecords(existing, coords, { source: "import-file" });
  saveAttacksStore(store);
  const after = getAttacksHistoryList(store).length;

  return {
    ok: true,
    added: Math.max(0, after - before),
    historyCount: after,
    attacksHistory: getAttacksHistoryList(store),
    attacksToday: getAttacksTodayList(store),
    todayCount: countAttacksToday(store),
  };
});

app.patch("/api/attacks/import", async (req, reply) => {
  const body = req.body ?? {};
  let store = normalizeAttacksStore(loadAttacksStore());

  if (body.clear === "today") {
    store = clearAttacksForDay(store);
  } else if (body.clear === "all") {
    store = emptyAttacksStore();
  } else if (Array.isArray(body.remove) && body.remove.length) {
    store = removeAttackCoords(store, body.remove);
  } else {
    reply.code(400);
    return { error: "remove[] ou clear (today|all) requis" };
  }

  saveAttacksStore(store);
  return {
    ok: true,
    todayCount: countAttacksToday(store),
    total: store.attacks.length,
    historyCount: getAttacksHistoryList(store).length,
    attacksToday: getAttacksTodayList(store),
    attacksHistory: getAttacksHistoryList(store),
  };
});

function buildAttackOptionsFromBody(body, dryRun = false) {
  const coords = (body.coords ?? []).map(coordsToTarget).filter(Boolean);
  return {
    coords,
    cp: body.cp ? Number(body.cp) : null,
    dryRun,
    spyJson: paths.spy.lootTargets(),
    skipAttackedFile: body.skipAttacked !== false ? paths.attacks.import() : null,
    sansDefenseOnly: body.sansDefenseOnly !== false,
    minLoot: body.minLoot ?? 0,
    battleShips: body.battleShips ?? 0,
    reserveSlots: body.reserveSlots ?? 0,
    delayMinMs: Number(process.env.ATTACK_LOOT_DELAY_MIN_MS) || 200,
    delayMaxMs: Number(process.env.ATTACK_LOOT_DELAY_MAX_MS) || 500,
  };
}

app.post("/api/attacks/preview", async (req, reply) => {
  try {
    const options = buildAttackOptionsFromBody(req.body ?? {}, true);
    const targets = buildAttackTargets(options);
    return { targets, count: targets.length };
  } catch (error) {
    reply.code(400);
    return { error: error.message };
  }
});

app.post("/api/attacks/send", async (req, reply) => {
  const body = req.body ?? {};
  const coords = (body.coords ?? []).map(coordsToTarget).filter(Boolean);
  if (!coords.length) {
    reply.code(400);
    return { error: "coords requis" };
  }

  const job = createJob("attack-send", { total: coords.length, done: 0 });

  runJob(job.id, async (onProgress) => {
    const client = await getClient();
    const options = buildAttackOptionsFromBody(body, false);
    const result = await sendAttackLootMissions(options, client);
    onProgress({
      done: result.results.length,
      total: result.meta.total,
      ok: result.results.filter((r) => r.ok).length,
    });
    return result;
  }).catch(() => {});

  return { jobId: job.id };
});

app.get("/api/fleets/active", async (req, reply) => {
  try {
    const cp = req.query.cp ? Number(req.query.cp) : null;
    const client = await getClient();
    return await fetchActiveFleets(client, cp);
  } catch (error) {
    reply.code(500);
    return { error: error.message };
  }
});

// --- Jobs ---

app.get("/api/jobs/:id", async (req, reply) => {
  const job = getJob(req.params.id);
  if (!job) {
    reply.code(404);
    return { error: "Job introuvable" };
  }
  return serializeJob(job);
});

app.get("/api/jobs/:id/events", async (req, reply) => {
  const job = getJob(req.params.id);
  if (!job) {
    reply.code(404);
    return { error: "Job introuvable" };
  }

  reply.raw.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (data) => {
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send({ type: "update", job: serializeJob(job) });

  const onEvent = (event) => send(event);
  job.emitter.on("event", onEvent);

  req.raw.on("close", () => {
    job.emitter.off("event", onEvent);
  });
});

// --- Static (production) ---

const webDist = join(ROOT, "web", "dist");
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist, prefix: "/" });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith("/api")) {
      reply.code(404).send({ error: "Not found" });
    } else {
      reply.sendFile("index.html");
    }
  });
}

await app.listen({ port: PORT, host: HOST });
console.log(`AstroGame UI → http://${HOST}:${PORT}`);

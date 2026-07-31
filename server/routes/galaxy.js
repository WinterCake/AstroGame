import { scrapeGalaxy } from "../../src/galaxy.js";
import { normalizeCoordString } from "../../src/spy-send.js";
import { filterGalaxyEntries, isQueryTruthy, sortRows } from "../../shared/query-utils.js";
import { createJob, runJob } from "../jobs.js";

export function registerGalaxyRoutes(app, ctx, { getClient }) {
  app.get("/api/galaxy/meta", async () => {
    const data = ctx.loadJson(ctx.paths.galaxy.global());
    if (!data) return { exists: false };
    return { exists: true, meta: data.meta };
  });

  app.get("/api/galaxy/entries", async (req) => {
    const data = ctx.loadJson(ctx.paths.galaxy.global());
    if (!data?.entries) return { entries: [], total: 0, meta: null };

    const spyCtx = ctx.loadSpiedTodayContext();
    let filtered = filterGalaxyEntries(data.entries, req.query);

    const excludeSpiedToday =
      isQueryTruthy(req.query.notSpiedToday) || isQueryTruthy(req.query.neverSpied);
    if (excludeSpiedToday) {
      filtered = filtered.filter((e) => !spyCtx.spiedTodaySet.has(normalizeCoordString(e.coords)));
    }
    if (isQueryTruthy(req.query.neverSpied)) {
      filtered = filtered.filter((e) => !spyCtx.allSpiedSet.has(normalizeCoordString(e.coords)));
    }

    const enriched = filtered.map((e) => ctx.enrichGalaxyEntryForApi(e, spyCtx));
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
      allSpied: spyCtx.allSpiedCount,
    };
  });

  app.get("/api/galaxy/players", async (req) => {
    const data = ctx.loadJson(ctx.paths.galaxy.global());
    if (!data?.entries) return { players: [], total: 0 };

    let players = data.players ?? ctx.groupEntriesByPlayer(data.entries);
    if (req.query.inactive === "true") players = players.filter((p) => p.inactivePlanets > 0);
    if (req.query.search) {
      const term = String(req.query.search).trim().toLowerCase();
      if (term) players = players.filter((p) => p.username?.toLowerCase().includes(term));
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize) || 50));
    const start = (page - 1) * pageSize;
    return { players: players.slice(start, start + pageSize), total: players.length, page, pageSize };
  });

  app.post("/api/galaxy/scrape", async (req) => {
    const body = req.body ?? {};
    const job = createJob("galaxy-scrape", { message: "Démarrage…" });
    runJob(job.id, async (onProgress) => {
      const client = await getClient();
      const options = {
        all: body.all !== false,
        refresh: body.refresh !== false,
        output: body.output ?? ctx.paths.galaxy.global(),
        onProgress: (progress) => {
          onProgress({
            scanned: progress.scanned,
            total: progress.total,
            planetEntries: progress.planetEntries,
            message: progress.message,
          });
        },
      };
      if (body.galaxy != null) {
        const g = Number(body.galaxy);
        options.galaxy = Number.isFinite(g) ? { from: g, to: g } : body.galaxy;
        options.all = false;
      }
      if (body.systems) options.system = body.systems;
      if (body.coords) {
        const [g, s] = String(body.coords).split(":").map(Number);
        options.coords = { galaxy: g, system: s };
        options.all = false;
      }
      const result = await scrapeGalaxy(options, client);
      onProgress({
        scanned: result.meta.systemsScannedThisRun,
        total: result.meta.systemsInRun,
        planetEntries: result.meta.planetEntries,
        message: "Scan galaxie terminé",
      });
      return result;
    }).catch(() => {});
    return { jobId: job.id };
  });
}

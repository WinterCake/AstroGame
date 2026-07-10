import {
  applySpyHiddenFilter,
  mergeSpyReports,
  purgeStaleSpyReports,
  recordSpiedSendSuccess,
  removeSpyReports,
  scrapeSpyReports,
  writeSpyReportsExcel,
} from "../../src/spy-reports.js";
import { saveSpyReportsBundle } from "../../src/spy-store.js";
import { listEmpirePlanets } from "../../src/empire.js";
import { sendAttackLootMissions, summarizeAttackLootResults } from "../../src/attack-loot-send.js";
import {
  fetchFleetSlotStatus,
  parseCoordLine,
  sendSpyMissions,
  summarizeSpySendResults,
} from "../../src/spy-send.js";
import { createJob, runJob } from "../jobs.js";
import { queryEnrichedSpyReports } from "../spy-query.js";

const QUICK_ATTACK_MAX = 30;

function coordsToTarget(coords) {
  if (typeof coords === "string") return parseCoordLine(coords);
  if (coords?.galaxy != null) return coords;
  return null;
}

export function registerSpyRoutes(app, ctx, { getClient }) {
  app.get("/api/spy/slots", async (req, reply) => {
    try {
      const client = await getClient();
      const cp = req.query.cp ? Number(req.query.cp) : undefined;
      return await fetchFleetSlotStatus(client, cp);
    } catch (error) {
      reply.code(500);
      return { error: error.message };
    }
  });

  app.get("/api/spy/reports", async (req) => {
    const { reports: sorted, meta, enrichment } = queryEnrichedSpyReports(ctx, req.query);

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
    const start = (page - 1) * pageSize;

    return {
      meta,
      reports: sorted.slice(start, start + pageSize),
      total: sorted.length,
      page,
      pageSize,
      attacksToday: enrichment.attacksTodayCount,
    };
  });

  app.get("/api/spy/reports/detail", async (req, reply) => {
    const coords = String(req.query.coords ?? "").trim();
    if (!/^\d+:\d+:\d+$/.test(coords)) {
      reply.code(400);
      return { error: "coords invalide (G:S:P)" };
    }
    const data = ctx.loadSpyReportsData();
    const report = (data.reports ?? []).find((r) => r.coords === coords);
    if (!report) {
      reply.code(404);
      return { error: "Rapport introuvable" };
    }
    return { report: ctx.enrichSpyReport(report, ctx.getSpyEnrichmentContext()) };
  });

  app.patch("/api/spy/reports", async (req, reply) => {
    const coords = Array.isArray(req.body?.remove) ? req.body.remove : [];
    if (!coords.length) {
      reply.code(400);
      return { error: "remove[] requis (coords G:S:P)" };
    }
    const current = ctx.loadSpyReportsData();
    const { data, removed } = removeSpyReports(current, coords);
    if (!removed) {
      reply.code(400);
      return { error: "Aucune coordonnée valide" };
    }
    ctx.saveSpyReportsData(data);
    return {
      ok: true,
      removed,
      total: data.reports.length,
      hiddenCount: data.meta?.hiddenCoords?.length ?? 0,
    };
  });

  app.post("/api/spy/reports/sync", async (req) => {
    const body = req.body ?? {};
    const job = createJob("spy-sync");
    runJob(job.id, async (onProgress) => {
      const client = await getClient();
      const output = body.output ?? ctx.paths.spy.reports();
      const lootOutput = body.lootOutput ?? ctx.paths.spy.lootTargets();
      const existing = ctx.loadSpyReportsData();
      const hiddenCoords = existing.meta?.hiddenCoords ?? [];

      const result = await scrapeSpyReports(
        { all: body.all !== false, maxPages: body.maxPages, output, existingReports: existing.reports ?? [] },
        client
      );

      const mergedReports = mergeSpyReports(existing.reports ?? [], result.reports);
      const galaxy = ctx.loadJson(ctx.paths.galaxy.global());
      const { data: purgedData, removed: staleRemoved } = purgeStaleSpyReports(
        { reports: mergedReports, meta: existing.meta },
        galaxy?.entries ?? []
      );
      const reports = hiddenCoords.length
        ? applySpyHiddenFilter(purgedData.reports, hiddenCoords)
        : purgedData.reports;

      const payload = {
        ...result,
        reports,
        meta: {
          ...existing.meta,
          ...result.meta,
          scrapedAt: new Date().toISOString(),
          hiddenCoords,
          totalReports: reports.length,
          staleRemoved: staleRemoved.length,
        },
      };

      if (!body.noExcel) await writeSpyReportsExcel(payload, ctx.paths.spy.reportsExcel());
      saveSpyReportsBundle(payload, { mirrorArchive: true });
      onProgress({
        totalReports: payload.meta.totalReports,
        newReports: payload.meta.newReports ?? 0,
        skippedReports: payload.meta.skippedReports ?? 0,
        message: "Sync terminée",
      });
      return payload;
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
    if (Number.isFinite(maxTargets) && maxTargets > 0) coords = coords.slice(0, maxTargets);

    const job = createJob("spy-send", { total: coords.length, done: 0 });
    runJob(job.id, async (onProgress) => {
      const client = await getClient();
      const spyOptions = {
        coords,
        cp: body.cp ? Number(body.cp) : null,
        dryRun: Boolean(body.dryRun),
        reserveSlots: body.reserveSlots ?? 0,
        onProgress: (progress) => onProgress(progress),
      };
      if (body.parallel != null) {
        spyOptions.parallel = Number(body.parallel);
        spyOptions.parallelFromCli = true;
      }
      const result = await sendSpyMissions(spyOptions, client);
      const stats = summarizeSpySendResults(result.results);
      const okCoords = result.results.filter((r) => r.ok && r.coords).map((r) => r.coords);
      if (okCoords.length && !body.dryRun) recordSpiedSendSuccess(okCoords);
      onProgress({ done: result.results.length, total: coords.length, ...stats });
      return result;
    }).catch(() => {});
    return { jobId: job.id };
  });

  app.post("/api/spy/quick-attacks", async (req, reply) => {
    const body = req.body ?? {};
    const maxTargets = Math.min(
      QUICK_ATTACK_MAX,
      Math.max(1, Number(body.maxTargets) || QUICK_ATTACK_MAX)
    );
    const filters = {
      sansDefense: body.sansDefense !== false,
      notAttacked: body.notAttacked !== false,
      inactive: body.inactive,
      minLoot: body.minLoot,
      sortBy: "loot",
      sortDir: "desc",
    };

    const { reports } = queryEnrichedSpyReports(ctx, filters);
    const candidateCoords = reports.filter((report) => !report.isNoob).map((r) => r.coords);
    if (!candidateCoords.length) {
      reply.code(400);
      return { error: "Aucune cible éligible avec les filtres actuels" };
    }

    if (body.dryRun) {
      try {
        const client = await getClient();
        const planets = await listEmpirePlanets(client, { forSource: true });
        const attackOptions = {
          coords: candidateCoords.map(coordsToTarget).filter(Boolean),
          spyJson: ctx.paths.spy.lootTargets(),
          skipAttackedFile: ctx.paths.attacks.import(),
          sansDefenseOnly: true,
          minLoot: Number(body.minLoot) || 0,
          maxTargets,
          useNearestPlanet: true,
          planets,
          dryRun: true,
        };
        const preview = await sendAttackLootMissions(attackOptions, client);
        return { count: preview.results.length, targets: preview.results, maxTargets };
      } catch (error) {
        reply.code(400);
        return { error: error.message };
      }
    }

    const job = createJob("spy-quick-attacks", { total: maxTargets, done: 0 });
    runJob(job.id, async (onProgress) => {
      const client = await getClient();
      const planets = await listEmpirePlanets(client, { forSource: true });
      if (!planets.length) {
        throw new Error("Aucune colonie disponible — connecte-toi et recharge l'onglet Empire.");
      }

      const result = await sendAttackLootMissions(
        {
          coords: candidateCoords.map(coordsToTarget).filter(Boolean),
          spyJson: ctx.paths.spy.lootTargets(),
          skipAttackedFile: ctx.paths.attacks.import(),
          sansDefenseOnly: true,
          minLoot: Number(body.minLoot) || 0,
          maxTargets,
          useNearestPlanet: true,
          planets,
          reserveSlots: 0,
        },
        client
      );

      const stats = summarizeAttackLootResults(result.results);
      onProgress({
        done: result.results.length,
        total: result.meta.total,
        ok: stats.ok,
        failed: stats.failed,
        weakPlayer: stats.weakPlayer,
        message: `${stats.ok} attaque(s) lancée(s)${stats.weakPlayer ? ` — ${stats.weakPlayer} joueur(s) trop faible(s)` : ""}`,
      });
      return result;
    }).catch(() => {});

    return { jobId: job.id, queued: maxTargets, maxTargets };
  });
}

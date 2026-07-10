import { getCredentials } from "../../src/config.js";
import {
  applyCombatHiddenFilter,
  ensureCombatReportDetails,
  filterCombatReports,
  finalizeCombatReport,
  getPlayerAttackCoordsTodayFromCombatReports,
  mergeCombatReports,
  removeCombatReports,
  scrapeCombatReports,
} from "../../src/combat-reports.js";
import { sortRows } from "../../shared/query-utils.js";
import { createJob, runJob } from "../jobs.js";

export function registerCombatRoutes(app, ctx, { getClient }) {
  app.get("/api/combat/reports", async (req) => {
    const data = ctx.loadCombatReportsData();
    let reports = data.reports ?? [];

    reports = filterCombatReports(reports, {
      search: req.query.search,
      result: req.query.result,
      coords: req.query.coords,
      today: req.query.today,
      minLoot: req.query.minLoot,
    });

    const sorted = sortRows(reports, req.query.sortBy, req.query.sortDir, {
      loot: (r) => r.loot ?? 0,
      timestamp: (r) => Number(r.timestamp) || 0,
      date: (r) => Number(r.timestamp) || 0,
      coords: (r) => r.coords ?? "",
      result: (r) => r.result ?? "",
    });

    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 100));
    const start = (page - 1) * pageSize;

    return {
      meta: data.meta,
      reports: sorted.slice(start, start + pageSize).map((report) => {
        const finalized = finalizeCombatReport(report);
        return { ...finalized, htmlBody: undefined, fullHtml: undefined };
      }),
      total: sorted.length,
      page,
      pageSize,
    };
  });

  app.get("/api/combat/reports/detail", async (req, reply) => {
    const messageId = String(req.query.messageId ?? "").trim();
    if (!messageId) {
      reply.code(400);
      return { error: "messageId requis" };
    }

    const data = ctx.loadJson(ctx.paths.combat.reports()) ?? { reports: [], meta: {} };
    const index = (data.reports ?? []).findIndex((r) => String(r.messageId) === messageId);
    if (index < 0) {
      reply.code(404);
      return { error: "Rapport introuvable" };
    }

    let report = data.reports[index];
    if (!report.fullHtml && report.raportHash) {
      try {
        const client = await getClient();
        report = await ensureCombatReportDetails(report, client);
        data.reports[index] = report;
        ctx.saveCombatReportsData(data);
      } catch (error) {
        reply.code(502);
        return { error: `Impossible de charger le rapport complet: ${error.message}` };
      }
    }

    return { report: finalizeCombatReport(report) };
  });

  app.patch("/api/combat/reports", async (req, reply) => {
    const messageIds = Array.isArray(req.body?.remove) ? req.body.remove.map(String) : [];
    if (!messageIds.length) {
      reply.code(400);
      return { error: "remove[] requis (messageId)" };
    }

    const current = ctx.loadJson(ctx.paths.combat.reports()) ?? { reports: [], meta: {} };
    const { data, removed } = removeCombatReports(current, messageIds);
    if (!removed) {
      reply.code(400);
      return { error: "Aucun messageId valide" };
    }

    ctx.saveCombatReportsData(data);
    return { ok: true, removed, total: data.reports.length };
  });

  app.post("/api/combat/reports/sync", async (req) => {
    const body = req.body ?? {};
    const job = createJob("combat-sync");

    runJob(job.id, async (onProgress) => {
      const client = await getClient();
      const output = body.output ?? ctx.paths.combat.reports();
      const existing = ctx.loadJson(output) ?? { meta: {}, reports: [] };
      const hiddenIds = existing.meta?.hiddenMessageIds ?? [];

      const scraped = await scrapeCombatReports(
        { all: body.all !== false, maxPages: body.maxPages, existingReports: existing.reports ?? [] },
        client
      );

      const merged = mergeCombatReports(existing.reports, scraped.reports);
      const reports = applyCombatHiddenFilter(merged, hiddenIds);
      const payload = {
        meta: {
          ...scraped.meta,
          ...existing.meta,
          scrapedAt: new Date().toISOString(),
          totalReports: reports.length,
          hiddenMessageIds: hiddenIds,
          lastSyncNew: scraped.meta?.newReports ?? scraped.reports.length,
          lastSyncFetched: scraped.meta?.detailsFetched ?? 0,
          lastSyncSkipped: scraped.meta?.detailsSkipped ?? 0,
        },
        reports,
      };

      ctx.saveCombatReportsData(payload);

      const { username } = getCredentials();
      const attackCoords = getPlayerAttackCoordsTodayFromCombatReports(reports, username);
      if (attackCoords.size) {
        const importStore = ctx.loadAttacksStore();
        ctx.saveAttacksStore(
          ctx.mergeAttackRecords(importStore, [...attackCoords], { source: "combat-sync" })
        );
      }

      onProgress({
        totalReports: reports.length,
        newReports: scraped.reports.length,
        detailsFetched: scraped.meta?.detailsFetched ?? 0,
        detailsSkipped: scraped.meta?.detailsSkipped ?? 0,
        message: "Sync terminée",
      });
      return payload;
    }).catch(() => {});

    return { jobId: job.id };
  });
}

import { filterSpyReports } from "../shared/spy-core.js";
import { sortRows } from "../shared/query-utils.js";

/** Filtre et enrichit les rapports spy (même logique que GET /api/spy/reports, sans pagination). */
export function queryEnrichedSpyReports(ctx, query = {}) {
  const data = ctx.loadSpyReportsData();
  let reports = data.reports ?? [];

  if (query.filter) reports = filterSpyReports(reports, query.filter);
  if (query.minLoot) {
    const min = Number(query.minLoot);
    reports = reports.filter((r) => (r.loot ?? 0) >= min);
  }
  if (query.sansDefense === "true" || query.sansDefense === true) {
    reports = filterSpyReports(reports, "sans-defense");
  }

  const enrichment = ctx.getSpyEnrichmentContext();
  if (query.notAttacked === "true" || query.notAttacked === true) {
    reports = reports.filter((r) => !enrichment.attackedTodaySet.has(r.coords));
  }
  if (query.spiedToday === "true") {
    reports = reports.filter(ctx.isReportToday);
  } else if (query.spiedToday === "false") {
    reports = reports.filter((r) => !ctx.isReportToday(r));
  }

  let enriched = reports.map((r) => ctx.enrichSpyReport(r, enrichment));
  if (query.inactive === "true") enriched = enriched.filter((r) => r.inactive);
  else if (query.inactive === "attackable") enriched = enriched.filter((r) => r.isAttackableInactive);
  else if (query.inactive === "false") {
    enriched = enriched.filter((r) => r.inactive === false && !r.onVacation);
  }

  const sorted = sortRows(enriched, query.sortBy ?? "loot", query.sortDir ?? "desc", {
    loot: (r) => r.loot ?? 0,
    rank: (r) => r.rank ?? Infinity,
    timestamp: (r) => Number(r.timestamp) || 0,
    date: (r) => Number(r.timestamp) || 0,
  });

  return { reports: sorted, meta: data.meta, enrichment };
}

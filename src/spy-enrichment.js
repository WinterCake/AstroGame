import { getAttackedTodayCoords } from "./attacks-history.js";
import { getPlayerAttackCoordsTodayFromCombatReports } from "./combat-reports.js";

export function enrichSpyReport(report, { attackedTodaySet, galaxyByCoord }) {
  const g = galaxyByCoord.get(report.coords);
  const attackedToday = attackedTodaySet.has(report.coords);
  return {
    ...report,
    rank: g?.rank ?? null,
    points: g?.points ?? null,
    inactive: g?.inactive ?? null,
    isAttackableInactive: g?.isAttackableInactive ?? null,
    onVacation: g?.onVacation ?? null,
    isNoob: g?.isNoob ?? null,
    isStrong: g?.isStrong ?? null,
    activityLabel: g?.activityLabel ?? null,
    attackedToday,
    alreadyAttacked: attackedToday,
  };
}

/** Assemble le contexte d'enrichissement spy à partir de données déjà chargées. */
export function buildSpyEnrichmentContext({ attacksImport, combatReports, username, galaxyEntries }) {
  const attackedTodaySet = getAttackedTodayCoords(attacksImport);

  if (combatReports?.length && username) {
    for (const coord of getPlayerAttackCoordsTodayFromCombatReports(combatReports, username)) {
      attackedTodaySet.add(coord);
    }
  }

  const galaxyByCoord = new Map((galaxyEntries ?? []).map((e) => [e.coords, e]));
  return { attackedTodaySet, attacksTodayCount: attackedTodaySet.size, galaxyByCoord };
}

export function enrichGalaxyEntry(entry, { spiedTodaySet, allSpiedSet }, normalizeCoord) {
  const coords = normalizeCoord(entry.coords);
  return {
    ...entry,
    spiedToday: spiedTodaySet.has(coords),
    everSpied: allSpiedSet?.has(coords) ?? false,
  };
}

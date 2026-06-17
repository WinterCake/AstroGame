import type { SpyReport } from "../api/client";

export function formatPlayerActivity(report: Pick<
  SpyReport,
  "inactive" | "onVacation" | "isAttackableInactive" | "activityLabel"
>): { short: string; title: string; tone: "vacation" | "inactive" | "active" | "unknown" } {
  if (report.onVacation) {
    return { short: "VM", title: report.activityLabel ?? "En vacances", tone: "vacation" };
  }
  if (report.inactive == null && !report.activityLabel) {
    return { short: "—", title: "Statut inconnu — lance un scrape galaxie", tone: "unknown" };
  }
  if (report.isAttackableInactive || report.inactive) {
    return {
      short: "inactif",
      title: report.activityLabel ?? "Inactif (7j+)",
      tone: "inactive",
    };
  }
  return {
    short: report.activityLabel ?? "actif",
    title: report.activityLabel ?? "Joueur actif",
    tone: "active",
  };
}

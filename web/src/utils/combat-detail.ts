import type { CombatReport } from "../api/client";

export function formatCombatReportDate(report: Pick<CombatReport, "timestamp" | "dateText">): string {
  if (report.timestamp) {
    const date = new Date(report.timestamp * 1000);
    return date.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return report.dateText ?? "—";
}

export function combatResultTone(result?: string | null): string {
  const value = String(result ?? "").toLowerCase();
  if (value.includes("victoire")) return "tag ok";
  if (value.includes("défaite") || value.includes("defaite")) return "tag warn";
  if (value.includes("match")) return "tag";
  return "muted";
}

export function combatRowClass(result?: string | null, outcome?: string | null): string {
  const value = String(result ?? "").toLowerCase();
  if (value.includes("victoire") || outcome === "W") return "row-combat-win";
  if (value.includes("défaite") || value.includes("defaite") || outcome === "L") return "row-combat-loss";
  return "";
}

export function formatCombatLoot(
  report: Pick<CombatReport, "lootFormatted" | "lootMetal" | "lootCrystal" | "lootDeut">
): string {
  if (report.lootFormatted?.includes(" / ")) return report.lootFormatted;
  const m = formatCompactResource(report.lootMetal);
  const c = formatCompactResource(report.lootCrystal);
  const d = formatCompactResource(report.lootDeut);
  return `M ${m} / C ${c} / D ${d}`;
}

export function formatCombatResultLabel(result?: string | null, outcome?: string | null): string {
  const value = String(result ?? "").toLowerCase();
  if (value.includes("victoire") || outcome === "W") return "Victoire";
  if (value.includes("défaite") || value.includes("defaite") || outcome === "L") return "Défaite";
  if (value.includes("match") || outcome === "D") return "Match nul";
  if (value.includes("inconnu")) return "Inconnu";
  return result ?? "—";
}

export function formatCompactResource(value?: number | null): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} Md`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} K`;
  return String(Math.round(n));
}

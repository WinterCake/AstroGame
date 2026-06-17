import type { SpyReport } from "../api/client";
import { formatAmount } from "./format";
import { SPY_DETAIL_SECTIONS, SPY_ELEMENT_LABELS } from "./spy-labels";

export type SpyDetailItem = {
  id: string;
  name: string;
  value: number;
  display: string;
};

export type SpyDetailSection = {
  title: string;
  total: string;
  items: SpyDetailItem[];
};

function formatCompactCount(value: number): string {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return String(Math.round(n));
}

function getNonZeroSpyItems(
  categoryData: Record<string, number> | undefined,
  mode: "amount" | "count"
): SpyDetailItem[] {
  if (!categoryData) return [];

  return Object.entries(categoryData)
    .filter(([, value]) => Number(value) > 0)
    .sort(([leftId], [rightId]) => Number(leftId) - Number(rightId))
    .map(([id, value]) => {
      const amount = Number(value);
      const display = mode === "amount" ? formatAmount(amount) : formatCompactCount(amount);
      return {
        id,
        name: SPY_ELEMENT_LABELS[id] ?? `Élément ${id}`,
        value: amount,
        display,
      };
    });
}

export function buildSpyDetailSections(report: SpyReport): SpyDetailSection[] | null {
  if (!report.spyData) return null;

  return SPY_DETAIL_SECTIONS.map((section) => ({
    title: section.title,
    total: report[section.totalKey] ?? "—",
    items: getNonZeroSpyItems(report.spyData?.[section.key], section.mode),
  }));
}

export function formatSpyReportDate(report: SpyReport): string {
  if (report.timestamp) {
    const date = new Date(report.timestamp * 1000);
    return date.toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return report.dateText ?? "—";
}

export function verdictTone(verdict?: string): string {
  switch (verdict) {
    case "Gros butin":
      return "verdict-loot";
    case "Cible intéressante":
      return "verdict-target";
    case "Flotte présente":
      return "verdict-fleet";
    case "Défense lourde":
      return "verdict-heavy";
    case "Défense légère":
      return "verdict-light";
    default:
      return "verdict-muted";
  }
}

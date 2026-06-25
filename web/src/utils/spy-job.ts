import type { Job } from "../api/client";

export type SpySendJobResult = {
  meta?: {
    total?: number;
    ok?: number;
    failed?: number;
    weakPlayer?: number;
    planetGone?: number;
    coordsChanged?: number;
    otherFailed?: number;
    removedFromGalaxy?: string[];
    skipped?: number;
  };
  results?: Array<{ ok?: boolean; skipped?: boolean; reason?: string | null; code?: number }>;
};

function resolveSpySendStats(progress: { ok?: number }, result?: SpySendJobResult) {
  const meta = result?.meta;
  const results = result?.results ?? [];
  const ok = meta?.ok ?? progress.ok ?? results.filter((r) => r.ok).length;
  const total = meta?.total ?? results.length;
  const failed = meta?.failed ?? results.filter((r) => !r.ok).length;
  const weakPlayer =
    meta?.weakPlayer ?? results.filter((r) => r.reason === "weak_player").length;
  const planetGone =
    meta?.planetGone ?? results.filter((r) => r.reason === "planet_gone").length;
  const coordsChanged =
    meta?.coordsChanged ??
    results.filter((r) => r.reason === "coords_changed" || Number(r.code) === 601).length;
  const otherFailed =
    meta?.otherFailed ?? Math.max(0, failed - weakPlayer - planetGone - coordsChanged);
  const removed = meta?.removedFromGalaxy?.length ?? 0;

  return { ok, total, failed, weakPlayer, planetGone, coordsChanged, otherFailed, removed };
}

export function formatSpySendCompletionMessage(
  progress: { ok?: number },
  result?: SpySendJobResult
): string {
  const stats = resolveSpySendStats(progress, result);

  let msg = `Terminé — ${stats.ok} OK / ${stats.total} cible(s)`;
  if (stats.failed) {
    const parts: string[] = [];
    if (stats.weakPlayer) parts.push(`${stats.weakPlayer} trop faible`);
    if (stats.planetGone) parts.push(`${stats.planetGone} planète absente`);
    if (stats.coordsChanged) parts.push(`${stats.coordsChanged} coords obsolète(s)`);
    if (stats.otherFailed) parts.push(`${stats.otherFailed} autre(s) échec(s)`);
    msg += ` — ${stats.failed} échec(s)`;
    if (parts.length) msg += ` (${parts.join(", ")})`;
  }
  if (stats.removed) msg += ` — ${stats.removed} retirée(s) de la galaxie`;
  return msg;
}

export function isSpySendJobWarning(result?: SpySendJobResult): boolean {
  const stats = resolveSpySendStats({}, result);
  return stats.failed > 0 || stats.removed > 0;
}

export function handleSpySendJobUpdate(
  job: Job,
  coordsCount: number,
  setJobMsg: (msg: string) => void,
  setJobMsgWarn: (warn: boolean) => void,
  onComplete?: () => void
) {
  const p = job.progress as {
    ok?: number;
    done?: number;
    total?: number;
    failed?: number;
    weakPlayer?: number;
    planetGone?: number;
  };
  if (job.status === "running") {
    setJobMsgWarn(false);
    const failHint =
      p.failed != null && p.failed > 0
        ? ` — ${p.failed} échec(s)${p.weakPlayer ? ` dont ${p.weakPlayer} trop faible` : ""}`
        : "";
    setJobMsg(`Espionnage ${p.done ?? 0}/${p.total ?? coordsCount} — ${p.ok ?? 0} OK${failHint}`);
  }
  if (job.status === "completed") {
    const result = job.result as SpySendJobResult | undefined;
    setJobMsg(formatSpySendCompletionMessage(p, result));
    setJobMsgWarn(isSpySendJobWarning(result));
    onComplete?.();
  }
  if (job.status === "failed") {
    setJobMsgWarn(false);
    setJobMsg(`Erreur : ${job.error}`);
  }
}

export type AttackLootJobResult = {
  meta?: {
    total?: number;
    ok?: number;
    failed?: number;
    weakPlayer?: number;
    otherFailed?: number;
  };
  results?: Array<{ ok?: boolean; reason?: string | null }>;
};

function resolveAttackLootStats(
  progress: { ok?: number; failed?: number; weakPlayer?: number },
  result?: AttackLootJobResult,
  queued?: number
) {
  const meta = result?.meta;
  const results = result?.results ?? [];
  const ok = meta?.ok ?? progress.ok ?? results.filter((r) => r.ok).length;
  const total = meta?.total ?? queued ?? results.length;
  const failed = meta?.failed ?? progress.failed ?? results.filter((r) => !r.ok).length;
  const weakPlayer =
    meta?.weakPlayer ?? progress.weakPlayer ?? results.filter((r) => r.reason === "weak_player").length;
  const otherFailed = meta?.otherFailed ?? Math.max(0, failed - weakPlayer);
  return { ok, total, failed, weakPlayer, otherFailed };
}

export function formatAttackLootCompletionMessage(
  progress: { ok?: number; failed?: number; weakPlayer?: number },
  result?: AttackLootJobResult,
  queued?: number
): string {
  const stats = resolveAttackLootStats(progress, result, queued);
  let msg = `Attaques terminées — ${stats.ok} OK / ${stats.total} cible(s)`;
  if (stats.failed) {
    const parts: string[] = [];
    if (stats.weakPlayer) parts.push(`${stats.weakPlayer} trop faible`);
    if (stats.otherFailed) parts.push(`${stats.otherFailed} autre(s) échec(s)`);
    msg += ` — ${stats.failed} échec(s)`;
    if (parts.length) msg += ` (${parts.join(", ")})`;
  }
  return msg;
}

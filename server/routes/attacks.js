import {
  clearAttacksForDay,
  emptyAttacksStore,
  removeAttackCoords,
  serializeAttacksStore,
} from "../../src/attacks-history.js";
import {
  buildAttackTargets,
  sendAttackLootMissions,
} from "../../src/attack-loot-send.js";
import { parseCoordLine } from "../../src/spy-send.js";
import { createJob, runJob } from "../jobs.js";

function coordsToTarget(coords) {
  if (typeof coords === "string") return parseCoordLine(coords);
  if (coords?.galaxy != null) return coords;
  return null;
}

function buildAttackOptionsFromBody(body, dryRun = false, ctx) {
  const coords = (body.coords ?? []).map(coordsToTarget).filter(Boolean);
  return {
    coords,
    cp: body.cp ? Number(body.cp) : null,
    dryRun,
    spyJson: ctx.paths.spy.lootTargets(),
    skipAttackedFile: body.skipAttacked !== false ? ctx.paths.attacks.import() : null,
    sansDefenseOnly: body.sansDefenseOnly !== false,
    minLoot: body.minLoot ?? 0,
    battleShips: body.battleShips ?? 0,
    reserveSlots: body.reserveSlots ?? 0,
    delayMinMs: Number(process.env.ATTACK_LOOT_DELAY_MIN_MS) || 200,
    delayMaxMs: Number(process.env.ATTACK_LOOT_DELAY_MAX_MS) || 500,
  };
}

export function registerAttacksRoutes(app, ctx, { getClient }) {
  app.get("/api/attacks/import", async () => {
    const data = ctx.loadAttacksStore();
    const attacksToday = ctx.getAttacksTodayList(data);
    const attacksHistory = ctx.getAttacksHistoryList(data);
    const store = ctx.normalizeAttacksStore(data);
    const externalCoords = ctx.loadExternalAttackCoords();
    return {
      ...serializeAttacksStore(store, data.meta ?? {}),
      todayCount: ctx.countAttacksToday(data),
      historyCount: attacksHistory.length,
      attacksToday,
      attacksHistory,
      externalCoords,
    };
  });

  app.post("/api/attacks/import/merge-files", async () => {
    const coords = ctx.loadExternalAttackCoords();
    if (!coords.length) {
      return { ok: true, added: 0, message: "Aucune coordonnée dans les fichiers externes" };
    }

    const existing = ctx.loadAttacksStore();
    const before = ctx.getAttacksHistoryList(existing).length;
    const store = ctx.mergeAttackRecords(existing, coords, { source: "import-file" });
    ctx.saveAttacksStore(store);
    const after = ctx.getAttacksHistoryList(store).length;

    return {
      ok: true,
      added: Math.max(0, after - before),
      historyCount: after,
      attacksHistory: ctx.getAttacksHistoryList(store),
      attacksToday: ctx.getAttacksTodayList(store),
      todayCount: ctx.countAttacksToday(store),
    };
  });

  app.patch("/api/attacks/import", async (req, reply) => {
    const body = req.body ?? {};
    let store = ctx.normalizeAttacksStore(ctx.loadAttacksStore());

    if (body.clear === "today") {
      store = clearAttacksForDay(store);
    } else if (body.clear === "all") {
      store = emptyAttacksStore();
    } else if (Array.isArray(body.remove) && body.remove.length) {
      store = removeAttackCoords(store, body.remove);
    } else {
      reply.code(400);
      return { error: "remove[] ou clear (today|all) requis" };
    }

    ctx.saveAttacksStore(store);
    return {
      ok: true,
      todayCount: ctx.countAttacksToday(store),
      total: store.attacks.length,
      historyCount: ctx.getAttacksHistoryList(store).length,
      attacksToday: ctx.getAttacksTodayList(store),
      attacksHistory: ctx.getAttacksHistoryList(store),
    };
  });

  app.post("/api/attacks/preview", async (req, reply) => {
    try {
      const options = buildAttackOptionsFromBody(req.body ?? {}, true, ctx);
      const targets = buildAttackTargets(options);
      return { targets, count: targets.length };
    } catch (error) {
      reply.code(400);
      return { error: error.message };
    }
  });

  app.post("/api/attacks/send", async (req, reply) => {
    const body = req.body ?? {};
    const coords = (body.coords ?? []).map(coordsToTarget).filter(Boolean);
    if (!coords.length) {
      reply.code(400);
      return { error: "coords requis" };
    }
    if (!body.cp) {
      reply.code(400);
      return { error: "Planète de départ requise — sélectionne un monde dans l'onglet Attaques." };
    }

    const job = createJob("attack-send", { total: coords.length, done: 0 });
    runJob(job.id, async (onProgress) => {
      const client = await getClient();
      const options = buildAttackOptionsFromBody(body, false, ctx);
      const result = await sendAttackLootMissions(options, client);
      onProgress({
        done: result.results.length,
        total: result.meta.total,
        ok: result.results.filter((r) => r.ok).length,
      });
      return result;
    }).catch(() => {});
    return { jobId: job.id };
  });
}

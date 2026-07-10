import { getBuildings } from "../../src/buildings.js";
import {
  dedupePlanets,
  dedupePlanetsByCoords,
  isMoonPlanet,
  listEmpirePlanets,
  scanEmpireResources,
} from "../../src/empire.js";
import { sendAllResourcesToPlanet } from "../../src/empire-consolidate.js";
import { createJob, runJob } from "../jobs.js";

export function registerEmpireRoutes(app, ctx, { getClient }) {
  app.get("/api/empire/planets", async (_req, reply) => {
    try {
      const client = await getClient();
      const planets = await listEmpirePlanets(client, { forSource: true });
      return { planets };
    } catch (error) {
      reply.code(500);
      return { error: error.message };
    }
  });

  app.get("/api/empire/snapshot", async () => {
    const snapshot = ctx.loadJson(ctx.paths.empire.snapshot());
    if (!snapshot) return { snapshot: null };
    if (Array.isArray(snapshot.planets)) {
      snapshot.planets = dedupePlanetsByCoords(dedupePlanets(snapshot.planets));
    }
    return { snapshot };
  });

  app.post("/api/empire/scan", async (_req, reply) => {
    const job = createJob("empire-scan");
    runJob(job.id, async (onProgress) => {
      const client = await getClient();
      return scanEmpireResources(client, {
        onPlanet: ({ index, total, planet }) => onProgress({ index, total, coords: planet.coords }),
      });
    }).catch(() => {});
    return { jobId: job.id };
  });

  app.get("/api/empire/buildings", async (req, reply) => {
    try {
      const cp = req.query.cp ? Number(req.query.cp) : undefined;
      const client = await getClient();
      return await getBuildings(client, cp ? { cp } : {});
    } catch (error) {
      reply.code(500);
      return { error: error.message };
    }
  });

  app.post("/api/empire/consolidate", async (req, reply) => {
    const targetCp = Number(req.body?.targetCp);
    if (!targetCp) {
      reply.code(400);
      return { error: "targetCp requis (planète destination)" };
    }

    const snapshot = ctx.loadJson(ctx.paths.empire.snapshot());
    let planets = snapshot?.planets ?? [];
    if (Array.isArray(planets)) {
      planets = dedupePlanetsByCoords(dedupePlanets(planets)).map((p) => ({
        ...p,
        isMoon: p.isMoon ?? isMoonPlanet(p),
      }));
    }
    if (!planets.length) {
      reply.code(400);
      return { error: "Aucun snapshot empire — lance un scan d'abord." };
    }

    const job = createJob("empire-consolidate", { message: "Démarrage…" });
    runJob(job.id, async (onProgress) => {
      const client = await getClient();
      const result = await sendAllResourcesToPlanet(
        { targetCp, planets, onPlanet: (progress) => onProgress(progress) },
        client
      );
      onProgress({
        message: `${result.sent} transport(s) envoyé(s) vers ${result.targetCoords}`,
        sent: result.sent,
        sources: result.sources,
      });
      return result;
    }).catch(() => {});
    return { jobId: job.id };
  });
}

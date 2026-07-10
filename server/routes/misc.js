import { fetchActiveFleets } from "../../src/fleet-active.js";
import { getJob, serializeJob } from "../jobs.js";

export function registerFleetsRoutes(app, { getClient }) {
  app.get("/api/fleets/active", async (req, reply) => {
    try {
      const cp = req.query.cp ? Number(req.query.cp) : null;
      const client = await getClient();
      return await fetchActiveFleets(client, cp);
    } catch (error) {
      reply.code(500);
      return { error: error.message };
    }
  });
}

export function registerJobsRoutes(app) {
  app.get("/api/jobs/:id", async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) {
      reply.code(404);
      return { error: "Job introuvable" };
    }
    return serializeJob(job);
  });

  app.get("/api/jobs/:id/events", async (req, reply) => {
    const job = getJob(req.params.id);
    if (!job) {
      reply.code(404);
      return { error: "Job introuvable" };
    }

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (data) => {
      reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send({ type: "update", job: serializeJob(job) });

    const onEvent = (event) => send(event);
    job.emitter.on("event", onEvent);

    req.raw.on("close", () => {
      job.emitter.off("event", onEvent);
    });
  });
}

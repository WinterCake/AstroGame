import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";

/** @type {Map<string, { id: string, type: string, status: string, progress: object, result?: unknown, error?: string, emitter: EventEmitter }>} */
const jobs = new Map();

export function createJob(type, meta = {}) {
  const id = randomUUID();
  const emitter = new EventEmitter();
  const job = {
    id,
    type,
    status: "pending",
    progress: { ...meta },
    emitter,
    createdAt: new Date().toISOString(),
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) ?? null;
}

export function updateJob(id, patch) {
  const job = jobs.get(id);
  if (!job) return null;
  Object.assign(job, patch);
  if (patch.progress) {
    job.progress = { ...job.progress, ...patch.progress };
  }
  job.emitter.emit("event", { type: "update", job: serializeJob(job) });
  return job;
}

export function completeJob(id, result) {
  const job = updateJob(id, { status: "completed", result });
  job?.emitter.emit("event", { type: "done", job: serializeJob(job) });
  return job;
}

export function failJob(id, error) {
  const job = updateJob(id, { status: "failed", error: String(error) });
  job?.emitter.emit("event", { type: "error", job: serializeJob(job), error: String(error) });
  return job;
}

export function serializeJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    result: job.result,
    error: job.error,
    createdAt: job.createdAt,
  };
}

export async function runJob(id, fn) {
  const job = jobs.get(id);
  if (!job) throw new Error(`Job introuvable : ${id}`);
  updateJob(id, { status: "running" });
  try {
    const result = await fn((progress) => updateJob(id, { progress }));
    completeJob(id, result);
    return result;
  } catch (error) {
    failJob(id, error.message);
    throw error;
  }
}

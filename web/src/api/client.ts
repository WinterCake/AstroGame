export type Planet = {
  cp: number | null;
  coords: string;
  label: string;
  isMain?: boolean;
};

export type SessionStatus = {
  ok: boolean;
  connected: boolean;
  error?: string;
  cookies?: number;
};

export type Job = {
  id: string;
  type: string;
  status: "pending" | "running" | "completed" | "failed";
  progress: Record<string, unknown>;
  result?: unknown;
  error?: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? "GET";
  const body =
    init?.body ?? (method !== "GET" && method !== "HEAD" ? "{}" : undefined);

  const res = await fetch(path, {
    ...init,
    body,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? data.message ?? res.statusText);
  return data as T;
}

export const client = {
  session: () => api<SessionStatus>("/api/session"),
  login: () => api<{ ok: boolean }>("/api/session/login", { method: "POST" }),

  empirePlanets: () => api<{ planets: Planet[] }>("/api/empire/planets"),
  empireSnapshot: () => api<{ snapshot: unknown }>("/api/empire/snapshot"),
  empireScan: () => api<{ jobId: string }>("/api/empire/scan", { method: "POST" }),
  empireBuildings: (cp: number) => api<unknown>(`/api/empire/buildings?cp=${cp}`),

  galaxyMeta: () => api<{ exists: boolean; meta?: unknown }>("/api/galaxy/meta"),
  galaxyEntries: (params: URLSearchParams) =>
    api<{ entries: GalaxyEntry[]; total: number; page: number; totalPages: number; spiedToday?: number }>(
      `/api/galaxy/entries?${params}`
    ),

  spySlots: (cp?: number) =>
    api<unknown>(`/api/spy/slots${cp ? `?cp=${cp}` : ""}`),
  spyReports: (params: URLSearchParams) =>
    api<{ reports: SpyReport[]; total: number; attacksToday?: number }>(`/api/spy/reports?${params}`),
  spyReportDetail: (coords: string) =>
    api<{ report: SpyReport }>(`/api/spy/reports/detail?coords=${encodeURIComponent(coords)}`),
  spySync: () => api<{ jobId: string }>("/api/spy/reports/sync", { method: "POST", body: "{}" }),
  spySend: (body: {
    coords: string[];
    cp?: number;
    dryRun?: boolean;
    parallel?: number;
    maxTargets?: number;
  }) => api<{ jobId: string }>("/api/spy/send", { method: "POST", body: JSON.stringify(body) }),

  attacksImport: () =>
    api<AttacksImportData>("/api/attacks/import"),
  attacksImportMergeFiles: () =>
    api<AttacksImportMergeResult>("/api/attacks/import/merge-files", { method: "POST", body: "{}" }),
  attacksImportUpdate: (body: { remove?: string[]; clear?: "today" | "all" }) =>
    api<AttacksImportUpdateResult>("/api/attacks/import", {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  attacksPreview: (body: AttackBody) =>
    api<{ targets: AttackTarget[]; count: number }>("/api/attacks/preview", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  attacksSend: (body: AttackBody) =>
    api<{ jobId: string }>("/api/attacks/send", { method: "POST", body: JSON.stringify(body) }),

  fleetsActive: (cp?: number) =>
    api<{ fleets: ActiveFleet[]; count: number }>(
      `/api/fleets/active${cp ? `?cp=${cp}` : ""}`
    ),

  job: (id: string) => api<Job>(`/api/jobs/${id}`),
};

export type GalaxyEntry = {
  coords: string;
  galaxy: number;
  system: number;
  position: number;
  username: string;
  rank: number;
  points: number;
  planetName: string;
  inactive: boolean;
  isAttackableInactive: boolean;
  onVacation: boolean;
  spiedToday?: boolean;
  activityLabel?: string;
  alliance?: { tag: string; name: string };
  moon?: { name: string };
};

export type SpyReport = {
  coords: string;
  username: string;
  planetName: string;
  loot: number;
  lootFormatted: string;
  fleet?: number;
  fleetFormatted?: string;
  defense?: number;
  defenseFormatted?: string;
  metalMine?: number;
  crystalMine?: number;
  deutMine?: number;
  targetChance?: number | null;
  spyChance?: number | null;
  timestamp?: number | null;
  dateText?: string | null;
  verdict?: string;
  rank?: number;
  inactive?: boolean | null;
  isAttackableInactive?: boolean | null;
  onVacation?: boolean | null;
  activityLabel?: string | null;
  attackedToday?: boolean;
  alreadyAttacked?: boolean;
  spyData?: Record<string, Record<string, number>> | null;
};

export type AttackRecord = {
  coords: string;
  at?: number;
  source?: string;
};

export type AttacksImportData = {
  attacks: AttackRecord[];
  meta?: unknown;
  todayCount?: number;
  historyCount?: number;
  attacksToday?: AttackRecord[];
  attacksHistory?: AttackRecord[];
  externalCoords?: string[];
};

export type AttacksImportMergeResult = {
  ok: boolean;
  added: number;
  historyCount: number;
  message?: string;
  attacksToday?: AttackRecord[];
  attacksHistory?: AttackRecord[];
  todayCount?: number;
};

export type AttacksImportUpdateResult = {
  ok: boolean;
  todayCount: number;
  total: number;
  historyCount?: number;
  attacksToday: AttackRecord[];
  attacksHistory?: AttackRecord[];
};

export type AttackTarget = {
  coords: string;
  username: string;
  loot: number;
  lootFormatted: string;
  ships: number;
};

export type AttackBody = {
  coords: string[];
  cp?: number;
  skipAttacked?: boolean;
  sansDefenseOnly?: boolean;
  minLoot?: number;
};

export type AttackSendResult = {
  coords: string;
  ok: boolean;
  message?: string;
  error?: string;
  ships?: number;
  battleShips?: number;
  shipsLabel?: string;
  sourceCoords?: string | null;
  sourceLabel?: string | null;
  targetCoords?: string;
  planetName?: string | null;
  username?: string | null;
  durationOutSec?: number | null;
  durationReturnSec?: number | null;
  durationOutFormatted?: string | null;
  durationReturnFormatted?: string | null;
  arrivalAt?: number | null;
  returnAt?: number | null;
  lootFormatted?: string;
};

export type AttackSendPayload = {
  meta: {
    total: number;
    sentAt: string;
    sourceCoords?: string | null;
    sourceLabel?: string | null;
  };
  results: AttackSendResult[];
};

export type FleetShip = {
  id: string;
  count: number;
  shortLabel: string;
  name: string;
};

export type ActiveFleet = {
  fleetId?: string | number | null;
  mission: string;
  missionLabel: string;
  missionKind?: "attack" | "transport" | "other";
  status: string;
  statusLabel: string;
  sourceCoords: string | null;
  targetCoords: string | null;
  homeCoords?: string | null;
  sourceName?: string | null;
  targetName?: string | null;
  targetPlayer?: string | null;
  shipsLabel?: string | null;
  shipsDetail?: string | null;
  ships?: FleetShip[];
  restSec: number;
  durationOutSec?: number | null;
  durationReturnSec?: number | null;
  durationOutFormatted?: string | null;
  durationReturnFormatted?: string | null;
  arrivalInFormatted?: string | null;
  returnInFormatted?: string | null;
  arrivalAt?: number | null;
  returnAt?: number | null;
};

export function watchJob(jobId: string, onUpdate: (job: Job) => void): () => void {
  let closed = false;

  const poll = async () => {
    if (closed) return;
    try {
      const job = await client.job(jobId);
      onUpdate(job);
      if (job.status === "completed" || job.status === "failed") {
        cleanup();
      }
    } catch {
      /* ignore transient poll errors */
    }
  };

  const es = new EventSource(`/api/jobs/${jobId}/events`);
  es.onmessage = (ev) => {
    const data = JSON.parse(ev.data);
    if (data.job) onUpdate(data.job);
    if (data.job?.status === "completed" || data.job?.status === "failed") {
      cleanup();
    }
  };
  es.onerror = () => {
    poll();
  };

  const interval = setInterval(poll, 1500);
  poll();

  function cleanup() {
    if (closed) return;
    closed = true;
    clearInterval(interval);
    es.close();
  }

  return cleanup;
}

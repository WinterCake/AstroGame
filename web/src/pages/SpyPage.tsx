import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Crosshair, Radar, Trash2 } from "lucide-react";
import { client, watchJob, type Job, type SpyReport } from "../api/client";
import { IconText, PageTitle } from "../components/IconText";
import { SpyReportPanel } from "../components/SpyReportPanel";
import { PlayerActivityTag } from "../components/PlayerActivityTag";
import { SortableTh, useSortState } from "../components/SortableTh";
import { usePlanetSource } from "../context/PlanetSourceContext";
import type { AttacksRouteState } from "../navigation";
import { formatSpyReportDate, verdictTone } from "../utils/spy-detail";
import { handleSpySendJobUpdate } from "../utils/spy-job";
import {
  applyTableRowSelect,
  selectAllTableRows,
  toggleAllTableRows,
  toggleTableRow,
} from "../utils/table-selection";

type SpySortKey = "coords" | "username" | "loot" | "rank" | "timestamp";
type SpiedDateFilter = "" | "today" | "not-today";
type InactiveFilter = "" | "true" | "false" | "attackable";

const PARALLEL_KEY = "astrogame-spy-parallel";

export function SpyPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { sourceCp, planets } = usePlanetSource();
  const parallel = localStorage.getItem(PARALLEL_KEY) ?? "13";
  const [page, setPage] = useState(1);
  const [sansDefense, setSansDefense] = useState(true);
  const [notAttacked, setNotAttacked] = useState(true);
  const [inactive, setInactive] = useState<InactiveFilter>("true");
  const [spiedDateFilter, setSpiedDateFilter] = useState<SpiedDateFilter>("");
  const [minLoot, setMinLoot] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectedCoords, setSelectedCoords] = useState<string | null>(null);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const [jobMsgWarn, setJobMsgWarn] = useState(false);
  const tableRef = useRef<HTMLDivElement>(null);
  const { sortKey, sortDir, toggle } = useSortState<SpySortKey>("loot", "desc");

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "100" });
    if (sansDefense) p.set("sansDefense", "true");
    if (notAttacked) p.set("notAttacked", "true");
    if (inactive) p.set("inactive", inactive);
    if (spiedDateFilter === "today") p.set("spiedToday", "true");
    if (spiedDateFilter === "not-today") p.set("spiedToday", "false");
    if (minLoot) p.set("minLoot", minLoot);
    p.set("sortBy", sortKey);
    p.set("sortDir", sortDir);
    return p;
  }, [page, sansDefense, notAttacked, inactive, spiedDateFilter, minLoot, sortKey, sortDir]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["spy-reports", params.toString()],
    queryFn: () => client.spyReports(params),
  });

  const reports = data?.reports ?? [];

  useEffect(() => {
    const el = tableRef.current;
    if (!el) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        selectAllTableRows(reports, (r) => r.coords, setSelected);
      }
    };
    el.addEventListener("keydown", onKeyDown);
    return () => el.removeEventListener("keydown", onKeyDown);
  }, [reports]);

  const listReport = useMemo(
    () => (selectedCoords ? reports.find((r) => r.coords === selectedCoords) : undefined),
    [reports, selectedCoords]
  );

  const detailQuery = useQuery({
    queryKey: ["spy-report-detail", selectedCoords],
    queryFn: () => client.spyReportDetail(selectedCoords!),
    enabled: Boolean(selectedCoords && !listReport?.spyData),
  });

  const activeReport: SpyReport | null = useMemo(() => {
    if (!selectedCoords) return null;
    if (listReport?.spyData) return listReport;
    return detailQuery.data?.report ?? listReport ?? null;
  }, [selectedCoords, listReport, detailQuery.data?.report]);

  const sync = useMutation({
    mutationFn: client.spySync,
    onSuccess: ({ jobId }) => {
      setJobMsg("Sync rapports…");
      watchJob(jobId, (job: Job) => {
        if (job.status === "running") setJobMsg("Sync en cours…");
        if (job.status === "completed") {
          const result = job.result as {
            meta?: { totalReports?: number; newReports?: number; skippedReports?: number };
          } | undefined;
          const meta = result?.meta;
          const fresh = meta?.newReports ?? 0;
          const skipped = meta?.skippedReports ?? 0;
          setJobMsg(
            `Rapports synchronisés — ${meta?.totalReports ?? "?"} au total` +
              (fresh || skipped ? ` (${fresh} nouveaux, ${skipped} ignorés)` : "")
          );
          refetch();
        }
        if (job.status === "failed") setJobMsg(`Erreur : ${job.error}`);
      });
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  const removeReports = useMutation({
    mutationFn: (coords: string[]) => client.spyReportsUpdate({ remove: coords }),
    onSuccess: (_data, coords) => {
      setJobMsg(`${coords.length} rapport(s) supprimé(s)`);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const coord of coords) next.delete(coord);
        return next;
      });
      if (selectedCoords && coords.includes(selectedCoords)) {
        setSelectedCoords(null);
      }
      qc.invalidateQueries({ queryKey: ["spy-reports"] });
      qc.invalidateQueries({ queryKey: ["spy-report-detail"] });
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  const respy = useMutation({
    mutationFn: (coords: string[]) =>
      client.spySend({
        coords,
        cp: sourceCp ?? undefined,
        parallel: Number(parallel) || 13,
      }),
    onSuccess: ({ jobId }, coords) => {
      setJobMsgWarn(false);
      setJobMsg(`Espionnage de ${coords.length} cible(s)…`);
      watchJob(jobId, (job: Job) => {
        handleSpySendJobUpdate(job, coords.length, setJobMsg, setJobMsgWarn, () => {
          refetch();
          qc.invalidateQueries({ queryKey: ["spy-report-detail"] });
          qc.invalidateQueries({ queryKey: ["galaxy-entries"] });
        });
      });
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  function handleRowSelect(coords: string, event: React.MouseEvent) {
    const nextAnchor = applyTableRowSelect(
      coords,
      event,
      reports,
      (r) => r.coords,
      selectionAnchor,
      setSelected
    );
    setSelectionAnchor(nextAnchor);
  }

  function toggleCoord(coords: string) {
    toggleTableRow(coords, setSelected);
    setSelectionAnchor(coords);
  }

  function toggleAllVisible() {
    toggleAllTableRows(reports, (r) => r.coords, selected, setSelected);
  }

  function selectReport(coords: string) {
    setSelectedCoords((current) => (current === coords ? null : coords));
  }

  function openReport(coords: string) {
    selectReport(coords);
  }

  function sendToAttacks(coords: string[]) {
    if (!coords.length) return;
    const state: AttacksRouteState = {
      coords: [...new Set(coords)],
      minLoot: minLoot || undefined,
    };
    navigate("/attacks", { state });
  }

  function deleteReports(coords: string[]) {
    if (!coords.length) return;
    const label = coords.length === 1 ? `le rapport ${coords[0]}` : `${coords.length} rapports`;
    if (!window.confirm(`Supprimer ${label} de la liste locale ?`)) return;
    removeReports.mutate(coords);
  }

  return (
    <div className="page page--table">
      <div className="page-header">
        <PageTitle icon={Radar}>Rapports espionnage</PageTitle>
        <div className="page-header-actions">
          {selected.size > 0 && (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={respy.isPending}
                title={
                  sourceCp
                    ? undefined
                    : "Planète source non définie — l'espionnage partira quand même, mais choisis un monde dans l'en-tête si les sondes ne partent pas."
                }
                onClick={() => respy.mutate([...selected])}
              >
                <IconText icon={Radar} size={15}>
                  Espionner ({selected.size})
                </IconText>
              </button>
              <button type="button" className="btn" onClick={() => sendToAttacks([...selected])}>
                <IconText icon={Crosshair} size={15}>
                  Vers attaques ({selected.size})
                </IconText>
              </button>
              <button
                type="button"
                className="btn btn-danger"
                disabled={removeReports.isPending}
                onClick={() => deleteReports([...selected])}
              >
                <IconText icon={Trash2} size={15}>
                  Supprimer ({selected.size})
                </IconText>
              </button>
            </>
          )}
          <button type="button" className="btn btn-primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <IconText icon={CloudDownload} size={15}>
              Sync depuis le jeu
            </IconText>
          </button>
        </div>
      </div>

      {jobMsg && <p className={`status-msg${jobMsgWarn ? " status-msg--warn" : ""}`}>{jobMsg}</p>}

      {!sourceCp && planets.length === 0 && (
        <p className="muted page-meta">
          Planète source indisponible — connecte-toi et ouvre l&apos;onglet Empire pour charger tes mondes.
        </p>
      )}
      {!sourceCp && planets.length > 0 && (
        <p className="muted page-meta">
          Aucune planète source sélectionnée — choisis-en une dans l&apos;en-tête pour envoyer les sondes depuis le bon monde.
        </p>
      )}

      <div className="filters">
        <label>
          <input
            type="checkbox"
            checked={sansDefense}
            onChange={(e) => setSansDefense(e.target.checked)}
          />
          Sans défense
        </label>
        <label>
          <input type="checkbox" checked={notAttacked} onChange={(e) => { setNotAttacked(e.target.checked); setPage(1); }} />
          Pas attaqué aujourd&apos;hui
        </label>
        <select value={inactive} onChange={(e) => { setInactive(e.target.value as InactiveFilter); setPage(1); }}>
          <option value="">Tous (activité)</option>
          <option value="false">Actifs</option>
          <option value="true">Inactifs</option>
          <option value="attackable">Inactifs attaquables</option>
        </select>
        <label className="inline-label">
          Date espionnage
          <select
            value={spiedDateFilter}
            onChange={(e) => {
              setSpiedDateFilter(e.target.value as SpiedDateFilter);
              setPage(1);
            }}
          >
            <option value="">Toutes</option>
            <option value="today">Aujourd&apos;hui</option>
            <option value="not-today">Avant aujourd&apos;hui</option>
          </select>
        </label>
        <input
          placeholder="Butin min"
          value={minLoot}
          onChange={(e) => { setMinLoot(e.target.value); setPage(1); }}
          style={{ width: 120 }}
        />
      </div>

      <p className="muted page-meta">
        {data?.total ?? 0} rapports — sélection : {selected.size}
        {data?.attacksToday != null && ` — ${data.attacksToday} attaqué(s) aujourd'hui`}
      </p>

      {isLoading && <p className="page-meta">Chargement…</p>}

      <div className={`split split--fill split--spy${selectedCoords ? "" : " split--solo"}`}>
        <div className="table-wrap table-wrap--fill" ref={tableRef} tabIndex={0}>
          <table className="data-table">
            <colgroup>
              <col className="col-check" />
              <col className="col-coords" />
              <col className="col-player" />
              <col className="col-loot" />
              <col className="col-rank" />
              <col className="col-flag" />
              <col className="col-time" />
              <col className="col-verdict" />
            </colgroup>
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={reports.length > 0 && reports.every((r) => selected.has(r.coords))}
                    onChange={toggleAllVisible}
                    aria-label="Tout sélectionner sur cette page"
                  />
                </th>
                <SortableTh label="Coords" active={sortKey === "coords"} dir={sortDir} onClick={() => { toggle("coords"); setPage(1); }} />
                <SortableTh label="Joueur" active={sortKey === "username"} dir={sortDir} onClick={() => { toggle("username"); setPage(1); }} />
                <SortableTh label="Butin" active={sortKey === "loot"} dir={sortDir} onClick={() => { toggle("loot"); setPage(1); }} />
                <SortableTh label="Rang" active={sortKey === "rank"} dir={sortDir} onClick={() => { toggle("rank"); setPage(1); }} />
                <th>Activité</th>
                <SortableTh label="Date" active={sortKey === "timestamp"} dir={sortDir} onClick={() => { toggle("timestamp", "desc"); setPage(1); }} />
                <th>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r: SpyReport) => {
                const attackedToday = r.attackedToday ?? r.alreadyAttacked;
                return (
                  <tr
                    key={r.coords}
                    className={[
                      selected.has(r.coords) ? "selected" : "",
                      selectedCoords === r.coords ? "row-active" : "",
                      attackedToday ? "row-attacked-today" : "",
                      "row-clickable",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={(e) => handleRowSelect(r.coords, e)}
                  >
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={selected.has(r.coords)}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => toggleCoord(r.coords)}
                      />
                    </td>
                    <td
                      className="col-coords col-coords--link"
                      title={`${r.coords} — clic pour le détail`}
                      onClick={(e) => {
                        e.stopPropagation();
                        openReport(r.coords);
                      }}
                    >
                      {r.coords}
                    </td>
                    <td className="col-player" title={r.username}>{r.username}</td>
                    <td className="col-loot">{r.lootFormatted}</td>
                    <td className="col-rank">{r.rank ?? "—"}</td>
                    <td className="col-flag">
                      <PlayerActivityTag report={r} />
                    </td>
                    <td className="col-time" title={r.dateText ?? undefined}>
                      {formatSpyReportDate(r)}
                    </td>
                    <td className="col-verdict" title={r.verdict ?? ""}>
                      <span className={verdictTone(r.verdict)}>{r.verdict ?? "—"}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {selectedCoords && (
          <SpyReportPanel
            report={activeReport}
            loading={detailQuery.isFetching && !activeReport?.spyData}
            onClose={() => setSelectedCoords(null)}
            onRespy={(coords) => respy.mutate([...coords])}
            respyDisabled={respy.isPending}
            respyPending={respy.isPending}
            onSendToAttacks={(coords) => sendToAttacks([coords])}
            onDelete={(coords) => deleteReports([coords])}
            deletePending={removeReports.isPending}
          />
        )}
      </div>

      <div className="pagination">
        <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Précédent
        </button>
        <span>Page {page}</span>
        <button type="button" className="btn" onClick={() => setPage((p) => p + 1)}>
          Suivant
        </button>
      </div>

      <p className="muted page-meta">
        <strong>Sélection :</strong> clic = une ligne · Ctrl+clic = ajouter/retirer · Shift+clic = plage · Ctrl+A = toute la page · coords = détail.
      </p>
    </div>
  );
}

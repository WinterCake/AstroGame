import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Crosshair, Radar } from "lucide-react";
import { client, watchJob, type Job, type SpyReport } from "../api/client";
import { IconText, PageTitle } from "../components/IconText";
import { SpyReportPanel } from "../components/SpyReportPanel";
import { PlayerActivityTag } from "../components/PlayerActivityTag";
import { SortableTh, useSortState } from "../components/SortableTh";
import { usePlanetSource } from "../context/PlanetSourceContext";
import type { AttacksRouteState } from "../navigation";
import { formatSpyReportDate } from "../utils/spy-detail";
import {
  applyTableRowSelect,
  selectAllTableRows,
  toggleAllTableRows,
  toggleTableRow,
} from "../utils/table-selection";

type SpySortKey = "coords" | "username" | "loot" | "rank" | "timestamp";
type SpiedDateFilter = "" | "today" | "not-today";

const PARALLEL_KEY = "astrogame-spy-parallel";

export function SpyPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { sourceCp } = usePlanetSource();
  const parallel = localStorage.getItem(PARALLEL_KEY) ?? "13";
  const [page, setPage] = useState(1);
  const [sansDefense, setSansDefense] = useState(true);
  const [notAttacked, setNotAttacked] = useState(true);
  const [spiedDateFilter, setSpiedDateFilter] = useState<SpiedDateFilter>("");
  const [minLoot, setMinLoot] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectedCoords, setSelectedCoords] = useState<string | null>(null);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const { sortKey, sortDir, toggle } = useSortState<SpySortKey>("loot", "desc");

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "100" });
    if (sansDefense) p.set("sansDefense", "true");
    if (notAttacked) p.set("notAttacked", "true");
    if (spiedDateFilter === "today") p.set("spiedToday", "true");
    if (spiedDateFilter === "not-today") p.set("spiedToday", "false");
    if (minLoot) p.set("minLoot", minLoot);
    p.set("sortBy", sortKey);
    p.set("sortDir", sortDir);
    return p;
  }, [page, sansDefense, notAttacked, spiedDateFilter, minLoot, sortKey, sortDir]);

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
          setJobMsg("Rapports synchronisés");
          refetch();
        }
        if (job.status === "failed") setJobMsg(`Erreur : ${job.error}`);
      });
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
      setJobMsg(`Espionnage de ${coords.length} cible(s)…`);
      watchJob(jobId, (job: Job) => {
        const p = job.progress as { ok?: number; done?: number; total?: number };
        if (job.status === "running") setJobMsg(`Espionnage ${p.done ?? 0}/${p.total ?? coords.length}`);
        if (job.status === "completed") {
          setJobMsg(`Espionnage terminé — ${p.ok ?? 0} OK`);
          refetch();
          qc.invalidateQueries({ queryKey: ["spy-report-detail"] });
          qc.invalidateQueries({ queryKey: ["galaxy-entries"] });
        }
        if (job.status === "failed") setJobMsg(`Erreur : ${job.error}`);
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
                disabled={!sourceCp || respy.isPending}
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
            </>
          )}
          <button type="button" className="btn btn-primary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <IconText icon={CloudDownload} size={15}>
              Sync depuis le jeu
            </IconText>
          </button>
        </div>
      </div>

      {jobMsg && <p className="status-msg">{jobMsg}</p>}

      <div className="filters">
        <label>
          <input type="checkbox" checked={sansDefense} onChange={(e) => setSansDefense(e.target.checked)} />
          Sans défense
        </label>
        <label>
          <input type="checkbox" checked={notAttacked} onChange={(e) => { setNotAttacked(e.target.checked); setPage(1); }} />
          Pas attaqué aujourd&apos;hui
        </label>
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
                    <td className="col-verdict" title={r.verdict ?? ""}>{r.verdict ?? "—"}</td>
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
            onRespy={(coords) => respy.mutate([coords])}
            respyDisabled={!sourceCp}
            respyPending={respy.isPending}
            onSendToAttacks={(coords) => sendToAttacks([coords])}
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

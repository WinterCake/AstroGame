import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CloudDownload, Swords, Trash2 } from "lucide-react";
import { client, watchJob, type CombatReport, type Job } from "../api/client";
import { CombatReportPanel } from "../components/CombatReportPanel";
import { IconText, PageTitle } from "../components/IconText";
import { SortableTh, useSortState } from "../components/SortableTh";
import { combatResultTone, combatRowClass, formatCombatLoot, formatCombatReportDate, formatCombatResultLabel } from "../utils/combat-detail";

type CombatSortKey = "timestamp" | "coords" | "loot" | "result";
type ResultFilter = "" | "victoire" | "défaite" | "match nul" | "rien";

export function CombatReportsPage() {
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("");
  const [minLoot, setMinLoot] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const { sortKey, sortDir, toggle } = useSortState<CombatSortKey>("timestamp", "desc");

  const params = useMemo(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: "100" });
    if (search) p.set("search", search);
    if (resultFilter) p.set("result", resultFilter);
    if (minLoot) p.set("minLoot", minLoot);
    p.set("sortBy", sortKey);
    p.set("sortDir", sortDir);
    return p;
  }, [page, search, resultFilter, minLoot, sortKey, sortDir]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["combat-reports", params.toString()],
    queryFn: () => client.combatReports(params),
  });

  const reports = data?.reports ?? [];

  const listReport = useMemo(
    () => (selectedMessageId ? reports.find((r) => r.messageId === selectedMessageId) : undefined),
    [reports, selectedMessageId]
  );

  const detailQuery = useQuery({
    queryKey: ["combat-report-detail", selectedMessageId],
    queryFn: () => client.combatReportDetail(selectedMessageId!),
    enabled: Boolean(selectedMessageId),
  });

  const activeReport: CombatReport | null = useMemo(() => {
    if (!selectedMessageId) return null;
    return detailQuery.data?.report ?? listReport ?? null;
  }, [selectedMessageId, listReport, detailQuery.data?.report]);

  const sync = useMutation({
    mutationFn: client.combatSync,
    onSuccess: ({ jobId }) => {
      setJobMsg("Sync rapports de combat…");
      watchJob(jobId, (job: Job) => {
        if (job.status === "running") setJobMsg("Sync en cours…");
        if (job.status === "completed") {
          const result = job.result as {
            meta?: { totalReports?: number; detailsFetched?: number; detailsSkipped?: number };
          } | undefined;
          const meta = result?.meta;
          const fetched = meta?.detailsFetched ?? 0;
          const skipped = meta?.detailsSkipped ?? 0;
          setJobMsg(
            `Rapports synchronisés — ${meta?.totalReports ?? "?"} au total` +
              (fetched || skipped ? ` (${fetched} chargés, ${skipped} ignorés)` : "")
          );
          refetch();
          qc.invalidateQueries({ queryKey: ["combat-report-detail"] });
        }
        if (job.status === "failed") setJobMsg(`Erreur : ${job.error}`);
      });
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  const removeReports = useMutation({
    mutationFn: client.combatReportsUpdate,
    onSuccess: (_data, messageIds) => {
      setJobMsg(`${messageIds.length} rapport(s) supprimé(s)`);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of messageIds) next.delete(id);
        return next;
      });
      if (selectedMessageId && messageIds.includes(selectedMessageId)) {
        setSelectedMessageId(null);
      }
      qc.invalidateQueries({ queryKey: ["combat-reports"] });
      qc.invalidateQueries({ queryKey: ["combat-report-detail"] });
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  function openReport(messageId: string) {
    setSelectedMessageId((current) => (current === messageId ? null : messageId));
  }

  function toggleRow(messageId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  }

  function toggleAllVisible() {
    const allSelected = reports.length > 0 && reports.every((r) => selected.has(r.messageId));
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(reports.map((r) => r.messageId)));
    }
  }

  function deleteReports(messageIds: string[]) {
    if (!messageIds.length) return;
    const label =
      messageIds.length === 1 ? `le rapport #${messageIds[0]}` : `${messageIds.length} rapports`;
    if (!globalThis.confirm(`Supprimer ${label} de l'archive locale ?`)) return;
    removeReports.mutate({ remove: messageIds });
  }

  return (
    <div className="page page--table">
      <div className="page-header">
        <PageTitle icon={Swords}>Rapports de combat</PageTitle>
        <div className="page-header-actions">
          {selected.size > 0 && (
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
        <input
          placeholder="Recherche (coords, joueur, sujet…)"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
        <select
          value={resultFilter}
          onChange={(e) => {
            setResultFilter(e.target.value as ResultFilter);
            setPage(1);
          }}
        >
          <option value="">Tous résultats</option>
          <option value="victoire">Victoire</option>
          <option value="défaite">Défaite</option>
          <option value="match nul">Match nul</option>
          <option value="rien">Rien</option>
        </select>
        <input
          placeholder="Butin min"
          value={minLoot}
          onChange={(e) => {
            setMinLoot(e.target.value);
            setPage(1);
          }}
          style={{ width: 120 }}
        />
      </div>

      <p className="muted page-meta">
        {data?.total ?? 0} rapports — sélection : {selected.size}
      </p>

      {isLoading && <p className="page-meta">Chargement…</p>}

      <div className={`split split--fill split--spy${selectedMessageId ? "" : " split--solo"}`}>
        <div className="table-wrap table-wrap--fill">
          <table className="data-table">
            <colgroup>
              <col className="col-check" />
              <col className="col-time" />
              <col className="col-coords" />
              <col className="col-result" />
              <col className="col-loot" />
              <col className="col-loot" />
              <col className="col-player" />
              <col className="col-player" />
            </colgroup>
            <thead>
              <tr>
                <th className="col-check">
                  <input
                    type="checkbox"
                    checked={reports.length > 0 && reports.every((r) => selected.has(r.messageId))}
                    onChange={toggleAllVisible}
                    aria-label="Tout sélectionner sur cette page"
                  />
                </th>
                <SortableTh
                  label="Date"
                  active={sortKey === "timestamp"}
                  dir={sortDir}
                  onClick={() => {
                    toggle("timestamp", "desc");
                    setPage(1);
                  }}
                />
                <SortableTh
                  label="Coords"
                  active={sortKey === "coords"}
                  dir={sortDir}
                  onClick={() => {
                    toggle("coords");
                    setPage(1);
                  }}
                />
                <SortableTh
                  label="Résultat"
                  active={sortKey === "result"}
                  dir={sortDir}
                  onClick={() => {
                    toggle("result");
                    setPage(1);
                  }}
                />
                <SortableTh
                  label="Butin"
                  active={sortKey === "loot"}
                  dir={sortDir}
                  onClick={() => {
                    toggle("loot");
                    setPage(1);
                  }}
                />
                <th>Débris</th>
                <th>Attaquant</th>
                <th>Défenseur</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((report) => (
                <tr
                  key={report.messageId}
                  className={[
                    selected.has(report.messageId) ? "selected" : "",
                    selectedMessageId === report.messageId ? "row-active" : "",
                    combatRowClass(report.result, report.outcome),
                    "row-clickable",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => openReport(report.messageId)}
                >
                  <td className="col-check">
                    <input
                      type="checkbox"
                      checked={selected.has(report.messageId)}
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => toggleRow(report.messageId)}
                    />
                  </td>
                  <td className="col-time" title={report.dateText ?? undefined}>
                    {formatCombatReportDate(report)}
                  </td>
                  <td className="col-coords" title={report.coords ?? undefined}>
                    {report.coords ?? "—"}
                  </td>
                  <td className="col-result">
                    {report.result || report.outcome ? (
                      <span className={combatResultTone(report.result)}>
                        {formatCombatResultLabel(report.result, report.outcome)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td
                    className="col-loot col-loot-breakdown"
                    title={`Métal ${report.lootMetal ?? 0} · Crystal ${report.lootCrystal ?? 0} · Deut ${report.lootDeut ?? 0}`}
                  >
                    {formatCombatLoot(report)}
                  </td>
                  <td className="col-loot" title={report.debrisTotal ? String(report.debrisTotal) : undefined}>
                    {report.debrisFormatted ?? "—"}
                  </td>
                  <td className="col-player" title={report.attacker ?? undefined}>
                    {report.attacker ?? "—"}
                  </td>
                  <td className="col-player" title={report.defender ?? undefined}>
                    {report.defender ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selectedMessageId && (
          <CombatReportPanel
            report={activeReport}
            loading={detailQuery.isFetching && !activeReport?.htmlBody}
            onClose={() => setSelectedMessageId(null)}
            onDelete={(messageId) => deleteReports([messageId])}
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
        Archive locale dans <code>data/combat/reports.json</code> — utilise <strong>Sync depuis le jeu</strong> pour
        importer tes rapports de bataille (messages catégorie combat).
      </p>
    </div>
  );
}

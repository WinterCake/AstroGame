import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, FolderInput, ListChecks, Radar, Rocket, Trash2 } from "lucide-react";
import {
  client,
  watchJob,
  type AttackRecord,
  type AttackSendPayload,
  type AttackTarget,
  type Job,
} from "../api/client";
import { IconText, PageTitle } from "../components/IconText";
import { usePlanetSource } from "../context/PlanetSourceContext";
import { isAttacksRouteState } from "../navigation";
import { formatMissionTime } from "../utils/format";

const PARALLEL_KEY = "astrogame-spy-parallel";

type HistoryView = "all" | "today";

function formatAttackTime(at?: number | null): string {
  if (!at) return "date inconnue";
  return new Date(at).toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isTodayEntry(entry: AttackRecord): boolean {
  if (!entry.at) return false;
  const date = new Date(entry.at);
  const now = new Date();
  return (
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()
  );
}

export function AttacksPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { sourceCp } = usePlanetSource();
  const [coordsText, setCoordsText] = useState("");
  const [preview, setPreview] = useState<AttackTarget[] | null>(null);
  const [jobMsg, setJobMsg] = useState<string | null>(null);
  const [minLoot, setMinLoot] = useState("1000000000");
  const [historyView, setHistoryView] = useState<HistoryView>("all");
  const [historySelected, setHistorySelected] = useState<Set<string>>(new Set());
  const [lastSendReport, setLastSendReport] = useState<AttackSendPayload | null>(null);
  const parallel = localStorage.getItem(PARALLEL_KEY) ?? "13";

  useEffect(() => {
    if (!isAttacksRouteState(location.state)) return;
    setCoordsText(location.state.coords.join("\n"));
    if (location.state.minLoot != null && location.state.minLoot !== "") {
      setMinLoot(location.state.minLoot);
    }
    setPreview(null);
    setJobMsg(`${location.state.coords.length} cible(s) importée(s) depuis l'espionnage`);
    navigate(location.pathname, { replace: true, state: null });
  }, [location.pathname, location.state, navigate]);

  const importData = useQuery({ queryKey: ["attacks-import"], queryFn: client.attacksImport });

  const attacksHistory = importData.data?.attacksHistory ?? [];
  const attacksToday = importData.data?.attacksToday ?? [];
  const visibleHistory = historyView === "today" ? attacksToday : attacksHistory;
  const selectedHistoryCoords = useMemo(
    () => [...historySelected].filter((c) => visibleHistory.some((e) => e.coords === c)),
    [historySelected, visibleHistory]
  );

  function parseCoords(): string[] {
    return [
      ...new Set(
        coordsText
          .split(/[\s,;]+/)
          .map((s) => s.trim())
          .filter((s) => /^\d+:\d+:\d+$/.test(s))
      ),
    ];
  }

  const previewMutation = useMutation({
    mutationFn: () => {
      const coords = parseCoords();
      if (!coords.length) throw new Error("Aucune coordonnée valide");
      return client.attacksPreview({
        coords,
        cp: sourceCp ?? undefined,
        skipAttacked: true,
        sansDefenseOnly: true,
        minLoot: Number(minLoot) || 0,
      });
    },
    onSuccess: (data) => setPreview(data.targets),
    onError: (e: Error) => setJobMsg(e.message),
  });

  const sendMutation = useMutation({
    mutationFn: () => {
      const coords = preview?.map((t) => t.coords) ?? parseCoords();
      if (!coords.length) throw new Error("Aucune cible");
      return client.attacksSend({
        coords,
        cp: sourceCp ?? undefined,
        skipAttacked: true,
        sansDefenseOnly: true,
        minLoot: Number(minLoot) || 0,
      });
    },
    onSuccess: ({ jobId }) => {
      setJobMsg("Attaques en cours…");
      watchJob(jobId, (job: Job) => {
        const p = job.progress as { ok?: number; done?: number; total?: number };
        if (job.status === "running") setJobMsg(`Attaques ${p.done ?? 0}/${p.total ?? "?"}`);
        if (job.status === "completed") {
          const payload = job.result as AttackSendPayload | undefined;
          if (payload?.results?.length) setLastSendReport(payload);
          setJobMsg(`Terminé — ${p.ok ?? 0} OK`);
          qc.invalidateQueries({ queryKey: ["attacks-import"] });
          qc.invalidateQueries({ queryKey: ["spy-reports"] });
          qc.invalidateQueries({ queryKey: ["galaxy-entries"] });
          qc.invalidateQueries({ queryKey: ["fleets-active"] });
        }
        if (job.status === "failed") setJobMsg(`Erreur : ${job.error}`);
      });
    },
  });

  const historyUpdate = useMutation({
    mutationFn: client.attacksImportUpdate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attacks-import"] });
      qc.invalidateQueries({ queryKey: ["spy-reports"] });
      qc.invalidateQueries({ queryKey: ["galaxy-entries"] });
      setHistorySelected(new Set());
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  const mergeFiles = useMutation({
    mutationFn: client.attacksImportMergeFiles,
    onSuccess: (data) => {
      setJobMsg(
        data.added > 0
          ? `${data.added} coordonnée(s) ajoutée(s) depuis les fichiers externes`
          : data.message ?? "Import terminé"
      );
      qc.invalidateQueries({ queryKey: ["attacks-import"] });
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  const reSpyMutation = useMutation({
    mutationFn: (coords: string[]) =>
      client.spySend({
        coords,
        cp: sourceCp ?? undefined,
        parallel: Number(parallel) || 13,
      }),
    onSuccess: ({ jobId }, coords) => {
      setJobMsg(`Ré-espionnage de ${coords.length} cible(s)…`);
      watchJob(jobId, (job: Job) => {
        const p = job.progress as { ok?: number; done?: number; total?: number };
        if (job.status === "running") setJobMsg(`Espionnage ${p.done ?? 0}/${p.total ?? coords.length}`);
        if (job.status === "completed") {
          setJobMsg(`Espionnage terminé — ${p.ok ?? 0} OK`);
          qc.invalidateQueries({ queryKey: ["spy-reports"] });
          qc.invalidateQueries({ queryKey: ["galaxy-entries"] });
        }
        if (job.status === "failed") setJobMsg(`Erreur : ${job.error}`);
      });
    },
    onError: (e: Error) => setJobMsg(`Erreur : ${e.message}`),
  });

  function toggleHistoryCoord(coords: string) {
    setHistorySelected((prev) => {
      const next = new Set(prev);
      if (next.has(coords)) next.delete(coords);
      else next.add(coords);
      return next;
    });
  }

  function selectAllVisible() {
    setHistorySelected(new Set(visibleHistory.map((e) => e.coords)));
  }

  function fillCoords(coords: string[]) {
    if (!coords.length) return;
    setCoordsText(coords.join("\n"));
    setPreview(null);
    setJobMsg(`${coords.length} coordonnée(s) chargée(s) dans le formulaire`);
  }

  function reSpyCoords(coords: string[]) {
    if (!coords.length) return;
    reSpyMutation.mutate(coords);
  }

  const reSpyTarget =
    selectedHistoryCoords.length > 0
      ? selectedHistoryCoords
      : visibleHistory.map((e) => e.coords);

  return (
    <div className="page page--attacks">
      <div className="page-header">
        <PageTitle icon={Crosshair}>Attaques pillage</PageTitle>
      </div>

      {jobMsg && <p className="status-msg">{jobMsg}</p>}

      <div className="form-block form-block--attacks">
        <label>
          Coordonnées (une par ligne ou séparées par espace)
          <textarea
            rows={6}
            value={coordsText}
            onChange={(e) => setCoordsText(e.target.value)}
            placeholder="2:236:8&#10;2:29:9"
          />
        </label>

        <label>
          Butin minimum
          <input value={minLoot} onChange={(e) => setMinLoot(e.target.value)} />
        </label>

        <div className="actions">
          <button type="button" className="btn" onClick={() => previewMutation.mutate()} disabled={previewMutation.isPending}>
            <IconText icon={ListChecks} size={15}>
              Prévisualiser
            </IconText>
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={sendMutation.isPending || !sourceCp}
            onClick={() => sendMutation.mutate()}
          >
            <IconText icon={Rocket} size={15}>
              Lancer attaques
            </IconText>
          </button>
        </div>
      </div>

      <div className="page-attacks-upper">
      {preview && (
        <div>
          <h2>Preview — {preview.length} cible(s)</h2>
          <div className="table-wrap">
            <table className="data-table">
              <colgroup>
                <col className="col-coords" />
                <col className="col-player" />
                <col className="col-loot" />
                <col className="col-pt" />
              </colgroup>
              <thead>
                <tr>
                  <th>Coords</th>
                  <th>Joueur</th>
                  <th className="col-loot">Butin</th>
                  <th className="col-pt">PT</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((t) => (
                  <tr key={t.coords}>
                    <td className="col-coords">{t.coords}</td>
                    <td className="col-player" title={t.username}>{t.username}</td>
                    <td className="col-loot">{t.lootFormatted}</td>
                    <td className="col-pt">{t.ships}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {lastSendReport && lastSendReport.results.length > 0 && (
        <section className="attacks-report">
          <h2>
            Rapport du dernier envoi
            <span className="muted history-subtitle">
              {" "}
              — {formatAttackTime(Date.parse(lastSendReport.meta.sentAt))}
              {lastSendReport.meta.sourceLabel && ` — départ ${lastSendReport.meta.sourceLabel}`}
            </span>
          </h2>
          <div className="table-wrap">
            <table className="data-table">
              <colgroup>
                <col className="col-status" />
                <col className="col-coords" />
                <col className="col-ships" />
                <col className="col-coords" />
                <col className="col-duration" />
                <col className="col-duration" />
                <col className="col-time" />
                <col className="col-time" />
              </colgroup>
              <thead>
                <tr>
                  <th>Statut</th>
                  <th>Départ</th>
                  <th>Vaisseaux</th>
                  <th>Arrivée</th>
                  <th>Aller</th>
                  <th>Retour</th>
                  <th>Arrivée à</th>
                  <th>Retour à</th>
                </tr>
              </thead>
              <tbody>
                {lastSendReport.results.map((row) => (
                  <tr key={row.coords} className={row.ok ? "row-ok" : "row-ko"}>
                    <td>{row.ok ? "OK" : "KO"}</td>
                    <td className="col-coords" title={row.sourceLabel ?? undefined}>
                      {row.sourceCoords ?? "—"}
                    </td>
                    <td className="col-ships">{row.shipsLabel ?? "—"}</td>
                    <td className="col-coords" title={row.planetName ?? row.username ?? undefined}>
                      {row.targetCoords ?? row.coords}
                    </td>
                    <td className="col-duration">{row.durationOutFormatted ?? "—"}</td>
                    <td className="col-duration">{row.durationReturnFormatted ?? "—"}</td>
                    <td className="col-time">{formatMissionTime(row.arrivalAt)}</td>
                    <td className="col-time">{formatMissionTime(row.returnAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!lastSendReport.results.some((r) => r.ok) && (
            <p className="muted">Aucune attaque envoyée avec succès dans ce lot.</p>
          )}
        </section>
      )}
      </div>

      <section className="attacks-history attacks-history--fill">
        <div className="attacks-history-head">
          <h2>
            Historique attaques ({importData.data?.historyCount ?? attacksHistory.length})
            {importData.data?.todayCount != null && (
              <span className="muted history-subtitle"> — {importData.data.todayCount} aujourd&apos;hui</span>
            )}
          </h2>
          <div className="page-header-actions">
            <select
              value={historyView}
              onChange={(e) => {
                setHistoryView(e.target.value as HistoryView);
                setHistorySelected(new Set());
              }}
            >
              <option value="all">Tout l&apos;historique</option>
              <option value="today">Aujourd&apos;hui seulement</option>
            </select>
            <button type="button" className="btn" disabled={!visibleHistory.length} onClick={selectAllVisible}>
              Tout sélectionner
            </button>
            <button
              type="button"
              className="btn"
              disabled={!reSpyTarget.length}
              onClick={() => fillCoords(reSpyTarget)}
            >
              Mettre dans le formulaire
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!reSpyTarget.length || reSpyMutation.isPending || !sourceCp}
              onClick={() => reSpyCoords(reSpyTarget)}
            >
              <IconText icon={Radar} size={15}>
                Ré-espionner ({reSpyTarget.length})
              </IconText>
            </button>
            <button
              type="button"
              className="btn"
              disabled={mergeFiles.isPending}
              onClick={() => mergeFiles.mutate()}
              title="targets/previous-attacks.txt + exports data/attacks/history/"
            >
              <IconText icon={FolderInput} size={15}>
                Importer fichiers
              </IconText>
            </button>
            <button
              type="button"
              className="btn"
              disabled={!attacksToday.length || historyUpdate.isPending}
              onClick={() => historyUpdate.mutate({ clear: "today" })}
            >
              Vider aujourd&apos;hui
            </button>
            <button
              type="button"
              className="btn btn-danger"
              disabled={!attacksHistory.length || historyUpdate.isPending}
              onClick={() => {
                if (window.confirm("Supprimer tout l'historique des attaques enregistrées ?")) {
                  historyUpdate.mutate({ clear: "all" });
                }
              }}
            >
              Tout effacer
            </button>
          </div>
        </div>

        <p className="muted">
          Cibles déjà attaquées enregistrées dans <code>data/attacks/import.json</code>.
          Sélectionne des lignes pour ré-espionner ou retire une entrée pour réattaquer aujourd&apos;hui.
          {(importData.data?.externalCoords?.length ?? 0) > 0 && (
            <>
              {" "}
              Fichiers externes disponibles : {importData.data?.externalCoords?.length} coordonnée(s).
            </>
          )}
        </p>

        {!visibleHistory.length && (
          <p className="muted">
            Aucune attaque dans cette vue.
            {(importData.data?.externalCoords?.length ?? 0) > 0 && (
              <> Clique <strong>Importer fichiers</strong> pour récupérer les coords sauvegardées ailleurs.</>
            )}
          </p>
        )}

        {visibleHistory.length > 0 && (
          <div className="table-wrap table-wrap--fill">
            <table className="data-table">
              <colgroup>
                <col className="col-check" />
                <col className="col-coords" />
                <col className="col-time" />
                <col className="col-source" />
                <col className="col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th className="col-check" />
                  <th>Coords</th>
                  <th>Date</th>
                  <th>Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleHistory.map((entry) => (
                  <tr
                    key={entry.coords}
                    className={[
                      historySelected.has(entry.coords) ? "selected" : "",
                      isTodayEntry(entry) ? "row-attacked-today" : "",
                      "row-clickable",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    onClick={() => toggleHistoryCoord(entry.coords)}
                  >
                    <td className="col-check">
                      <input
                        type="checkbox"
                        checked={historySelected.has(entry.coords)}
                        onClick={(ev) => ev.stopPropagation()}
                        onChange={() => toggleHistoryCoord(entry.coords)}
                      />
                    </td>
                    <td className="col-coords">{entry.coords}</td>
                    <td className="col-time">{formatAttackTime(entry.at)}</td>
                    <td className="col-source">{entry.source ?? "—"}</td>
                    <td className="col-actions">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost"
                        title="Retirer de la liste"
                        disabled={historyUpdate.isPending}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          historyUpdate.mutate({ remove: [entry.coords] });
                        }}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
